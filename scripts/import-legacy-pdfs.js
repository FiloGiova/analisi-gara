#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { initializeDatabase, closeDatabase } from '../src/database/connection.js';
import { dbGet } from '../src/database/db.js';
import { parseFederationPdfBuffer } from '../src/services/federationPdfParser.js';
import {
  applyFederationPdfImport,
  previewFederationPdfImport
} from '../src/services/federationPdfImportService.js';

function usage() {
  console.log(`Uso:
  npm run import:legacy-pdfs -- --dry-run file1.pdf file2.pdf
  npm run import:legacy-pdfs -- --commit --user=USERNAME file1.pdf file2.pdf

Il parser usa esclusivamente il contenuto dei PDF federali. Il nome del file
viene mostrato nei log ma non determina mai gara, arbitro o ruolo.

La modalità --commit importa soltanto gruppi associati automaticamente e senza
conflitti. Per risolvere manualmente gare o nominativi usa l'interfaccia web.
`);
}

function parseArgs(argv) {
  const options = { commit: false, username: '' };
  const files = [];
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }
    if (arg === '--dry-run') options.commit = false;
    else if (arg === '--commit') options.commit = true;
    else if (arg.startsWith('--user=')) options.username = arg.slice('--user='.length).trim();
    else if (arg.startsWith('-')) throw new Error(`Opzione sconosciuta: ${arg}`);
    else files.push(arg);
  }
  if (!files.length) throw new Error('Indica almeno un PDF da analizzare.');
  if (files.length > 20) throw new Error('Puoi elaborare al massimo 20 PDF per volta.');
  if (options.commit && !options.username) throw new Error('Con --commit indica l’amministratore con --user=USERNAME.');
  return { options, files };
}

function loadFiles(paths) {
  return paths.map((filePath) => {
    const absolutePath = path.resolve(filePath);
    const buffer = fs.readFileSync(absolutePath);
    if (buffer.length > 4 * 1024 * 1024) throw new Error(`${filePath} supera il limite di 4 MB.`);
    return { originalname: path.basename(absolutePath), mimetype: 'application/pdf', buffer };
  });
}

async function printParsed(files) {
  const groups = new Map();
  for (const file of files) {
    const parsed = await parseFederationPdfBuffer(file.buffer);
    if (!groups.has(parsed.groupKey)) groups.set(parsed.groupKey, []);
    groups.get(parsed.groupKey).push({ file, parsed });
  }
  for (const [groupKey, items] of groups) {
    const header = items[0].parsed.header;
    console.log(`\n${groupKey} · ${header.teamHome} - ${header.teamAway} (${header.scoreHome}-${header.scoreAway})`);
    console.log(`  Valutatore: ${header.observerName}`);
    for (const item of items) {
      console.log(
        `  ${item.parsed.role === 'first' ? '1°' : '2°'} arbitro: ${item.parsed.header.targetRefereeName}` +
        ` · voto ${item.parsed.evaluation.vote || '-'} · ${item.file.originalname}`
      );
    }
  }
}

async function main() {
  const { options, files: filePaths } = parseArgs(process.argv.slice(2));
  const files = loadFiles(filePaths);
  await printParsed(files);
  if (!options.commit) {
    console.log('\nDry-run completato: nessuna modifica effettuata.');
    return;
  }

  await initializeDatabase();
  const row = await dbGet(
    `SELECT id, username, display_name FROM users
      WHERE username = ? AND role = 'admin' AND active = 1`,
    [options.username]
  );
  if (!row) throw new Error('Amministratore attivo non trovato.');
  const user = { id: row.id, username: row.username, displayName: row.display_name, role: 'admin' };
  const preview = await previewFederationPdfImport({ files, user });
  if (preview.fileErrors.length) {
    throw new Error(preview.fileErrors.map((item) => `${item.originalName}: ${item.message}`).join('\n'));
  }

  const decisions = preview.groups.map((group) => {
    if (group.duplicateRoles.length || group.requiresSharedSource || !group.automaticGameId ||
        !group.people.first.refereeId || !group.people.second.refereeId ||
        group.reportCandidates.length > 1) {
      throw new Error(`Gara ${group.matchNumber}: abbinamento non univoco, usa l’interfaccia web.`);
    }
    return {
      groupKey: group.groupKey,
      fileHashes: group.files.map((file) => file.hash),
      gameId: group.automaticGameId,
      reportId: group.automaticReportId,
      firstRefereeId: group.people.first.refereeId,
      secondRefereeId: group.people.second.refereeId,
      observerUserId: group.people.observer.userId,
      sharedSourceRole: group.presentRoles.includes('first') ? 'first' : group.presentRoles[0],
      replaceExisting: Boolean(group.automaticReportId)
    };
  });
  const result = await applyFederationPdfImport({ files, decisions, user });
  console.log(`\nImport completato: ${result.created} creati, ${result.updated} aggiornati, ${result.errors.length} errori.`);
}

main()
  .catch((error) => {
    console.error(`Errore import: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
