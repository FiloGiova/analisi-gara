/**
 * Import idempotente di una lista arbitri (XLSX) in una stagione/campionato.
 *
 * Uso:
 *   node scripts/import-referees.js <file.xlsx> --competition=DR1 [opzioni]
 *   node scripts/import-referees.js <file.xlsx> --competition=DR1 --commit
 *
 * Opzioni:
 *   --competition=<value>  campionato (valore della tabella competitions). Obbligatorio.
 *   --season=<2026/2027>   stagione sportiva. Default: stagione corrente.
 *   --sheet=<nome>         foglio da leggere. Default: il primo.
 *   --rows=<5-32>          limita l'import a un intervallo di righe del foglio.
 *   --esordienti-col=<B>   colonna con il flag esordiente: se contiene una "E"
 *                          l'arbitro finisce nella fascia Esordienti.
 *   --esordienti-rows=<47-54>  righe del foglio da iscrivere alla fascia Esordienti.
 *   --commit               applica le modifiche (senza, è solo un'anteprima).
 *
 * Il foglio deve avere una riga di intestazione con almeno "Cognome" e "Nome";
 * le altre colonne riconosciute sono Tessera, Provincia, Data di nascita,
 * Mail/e-Mail, Cellulare/Telefono, Data Scadenza Certificato. Le colonne assenti
 * non vengono toccate sugli arbitri già presenti.
 */
import 'dotenv/config';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { dbAll, dbTx, closePool } from '../src/database/db.js';
import { currentSportSeason } from '../shared/reportTemplate.js';

// --- argomenti ------------------------------------------------------------

function parseArgs(argv) {
  const options = { commit: false };
  const positional = [];
  for (const arg of argv) {
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const [key, value = 'true'] = arg.slice(2).split('=');
    options[key] = value;
  }
  options.commit = options.commit === true || options.commit === 'true';
  options.file = positional[0] || '';
  return options;
}

// Accetta sia la lettera della colonna Excel (B) sia il numero (2).
function parseColumn(value) {
  if (!value || value === 'true') return null;
  const raw = clean(value).toUpperCase();
  if (/^\d+$/.test(raw)) return Number(raw);
  if (!/^[A-Z]+$/.test(raw)) throw new Error(`Colonna non valida: ${value}.`);
  return [...raw].reduce((acc, letter) => acc * 26 + (letter.charCodeAt(0) - 64), 0);
}

function parseRowRange(value) {
  if (!value || value === 'true') return null;
  const match = String(value).match(/^(\d+)\s*-\s*(\d+)$/);
  if (!match) throw new Error(`Intervallo righe non valido: ${value} (atteso ad esempio 5-32).`);
  return { from: Number(match[1]), to: Number(match[2]) };
}

// --- normalizzazione dei valori ------------------------------------------

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function cellText(cell) {
  const value = cell?.value;
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return clean(value.richText.map((part) => part.text).join(''));
    if (value.text !== undefined) return clean(value.text);
    if (value.result !== undefined) return clean(value.result);
    return '';
  }
  return clean(value);
}

// Le date arrivano come oggetti Date (celle data) oppure come testo gg/mm/aaaa.
function toIsoDate(raw) {
  const value = clean(raw);
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const match = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

// Le liste FIP scrivono la tessera con gli zeri iniziali (068489), il database no.
function normalizeLicense(raw) {
  const digits = clean(raw).replace(/\D/g, '');
  if (!digits) return null;
  return String(Number(digits));
}

function normalizePhone(raw) {
  const value = clean(raw).replace(/[\s./-]/g, '');
  if (!value) return null;
  return value.replace(/^\+39/, '').replace(/^0039/, '');
}

function normalizeEmail(raw) {
  const value = clean(raw).toLowerCase();
  return value || null;
}

function nameKey(firstName, lastName) {
  return `${clean(lastName).toLocaleLowerCase('it')}|${clean(firstName).toLocaleLowerCase('it')}`;
}

// --- lettura del foglio ---------------------------------------------------

const COLUMN_ALIASES = [
  ['license_number', ['tessera', 'n. tessera', 'numero tessera']],
  ['last_name', ['cognome']],
  ['first_name', ['nome']],
  ['province', ['provincia']],
  ['birth_date', ['data di nascita', 'data nascita', 'nato il']],
  ['email', ['mail', 'e-mail', 'email', 'posta elettronica']],
  ['phone', ['cellulare', 'telefono', 'cell']],
  ['certificate_expiry', ['data scadenza certificato', 'scadenza certificato', 'scadenza']]
];

function headerKey(text) {
  return clean(text)
    .toLocaleLowerCase('it')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function mapHeaderRow(row) {
  const mapping = {};
  row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const key = headerKey(cellText(cell));
    if (!key) return;
    for (const [field, aliases] of COLUMN_ALIASES) {
      if (mapping[field] === undefined && aliases.includes(key)) mapping[field] = colNumber;
    }
  });
  return mapping;
}

function readSheet(worksheet, range, { esordientiColumn = null, esordientiRows = null } = {}) {
  let mapping = null;
  let headerRow = 0;
  const rows = [];

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (!mapping) {
      const candidate = mapHeaderRow(row);
      if (candidate.last_name && candidate.first_name) {
        mapping = candidate;
        headerRow = rowNumber;
      }
      return;
    }
    if (range && (rowNumber < range.from || rowNumber > range.to)) return;

    const lastName = cellText(row.getCell(mapping.last_name));
    const firstName = cellText(row.getCell(mapping.first_name));
    if (!lastName || !firstName) return;
    // Alcune liste ripetono l'intestazione a metà foglio.
    if (headerKey(lastName) === 'cognome') return;

    const fields = { last_name: lastName, first_name: firstName };
    if (mapping.license_number !== undefined) {
      fields.license_number = normalizeLicense(cellText(row.getCell(mapping.license_number)));
    }
    if (mapping.province !== undefined) fields.province = clean(cellText(row.getCell(mapping.province))) || null;
    if (mapping.birth_date !== undefined) fields.birth_date = toIsoDate(cellText(row.getCell(mapping.birth_date)));
    if (mapping.email !== undefined) fields.email = normalizeEmail(cellText(row.getCell(mapping.email)));
    if (mapping.phone !== undefined) fields.phone = normalizePhone(cellText(row.getCell(mapping.phone)));
    if (mapping.certificate_expiry !== undefined) {
      fields.certificate_expiry = toIsoDate(cellText(row.getCell(mapping.certificate_expiry)));
    }

    const flagText = esordientiColumn ? cellText(row.getCell(esordientiColumn)).toUpperCase() : '';
    const esordiente =
      flagText.includes('E') ||
      Boolean(esordientiRows && rowNumber >= esordientiRows.from && rowNumber <= esordientiRows.to);

    rows.push({ rowNumber, fields, esordiente });
  });

  if (!mapping) throw new Error('Intestazione non trovata: serve una riga con le colonne "Cognome" e "Nome".');
  return { headerRow, mapping, rows };
}

// --- confronto con il database -------------------------------------------

function sameValue(left, right) {
  return clean(left) === clean(right);
}

// Le colonne assenti dal foglio non devono cancellare i dati già presenti.
function diffFields(existing, fields) {
  const changes = [];
  for (const [field, value] of Object.entries(fields)) {
    if (value === null && existing && clean(existing[field]) === '') continue;
    if (existing && sameValue(existing[field], value)) continue;
    if (!existing) continue;
    changes.push({ field, from: existing[field] ?? null, to: value });
  }
  return changes;
}

async function buildPlan({ rows, season, competition }) {
  const existingRows = await dbAll(
    `SELECT r.*,
            sc.category AS season_category,
            sc.active   AS season_active
       FROM referees r
       LEFT JOIN referee_season_categories sc
         ON sc.referee_id = r.id AND sc.sport_season = ?`,
    [season]
  );

  const byLicense = new Map();
  const byName = new Map();
  for (const row of existingRows) {
    const license = normalizeLicense(row.license_number);
    if (license) byLicense.set(license, [...(byLicense.get(license) || []), row]);
    const key = nameKey(row.first_name, row.last_name);
    byName.set(key, [...(byName.get(key) || []), row]);
  }

  const seenLicenses = new Map();
  const seenNames = new Map();
  const conflicts = [];
  const plan = [];

  for (const { rowNumber, fields, esordiente } of rows) {
    const license = fields.license_number || null;
    const key = nameKey(fields.first_name, fields.last_name);
    const label = `${fields.last_name} ${fields.first_name} (riga ${rowNumber})`;

    if (license && seenLicenses.has(license)) {
      conflicts.push(`Tessera ${license} ripetuta nel foglio: righe ${seenLicenses.get(license)} e ${rowNumber}.`);
      continue;
    }
    if (seenNames.has(key)) {
      conflicts.push(`Nominativo ripetuto nel foglio: ${label} già alla riga ${seenNames.get(key)}.`);
      continue;
    }
    if (license) seenLicenses.set(license, rowNumber);
    seenNames.set(key, rowNumber);

    const licenseMatches = license ? byLicense.get(license) || [] : [];
    const nameMatches = byName.get(key) || [];
    if (licenseMatches.length > 1 || nameMatches.length > 1) {
      conflicts.push(`Più corrispondenze nel database per ${label}: risolvere a mano.`);
      continue;
    }

    const licenseRow = licenseMatches[0] || null;
    const nameRow = nameMatches[0] || null;
    if (licenseRow && nameRow && licenseRow.id !== nameRow.id) {
      conflicts.push(
        `${label}: la tessera ${license} è di ${licenseRow.last_name} ${licenseRow.first_name} (id ${licenseRow.id}), ` +
          `il nominativo è dell'id ${nameRow.id}.`
      );
      continue;
    }

    const existing = licenseRow || nameRow;
    const matchedBy = licenseRow ? 'tessera' : nameRow ? 'nominativo' : null;
    const changes = diffFields(existing, fields);
    const seasonReady =
      existing && existing.season_category === competition && Number(existing.season_active) === 1;

    let action = 'create';
    if (existing) {
      if (changes.length || Number(existing.active) !== 1) action = 'update';
      else action = seasonReady ? 'unchanged' : 'season';
    }

    plan.push({ rowNumber, fields, existing, matchedBy, changes, action, esordiente });
  }

  return { plan, conflicts, existingCount: existingRows.length };
}

// --- scrittura ------------------------------------------------------------

const WRITABLE_FIELDS = [
  'license_number',
  'first_name',
  'last_name',
  'birth_date',
  'email',
  'phone',
  'province',
  'certificate_expiry'
];

async function applyPlan(plan, { season, competition }) {
  await dbTx(async (client) => {
    for (const item of plan) {
      let refereeId = item.existing?.id ?? null;

      if (!refereeId) {
        const columns = WRITABLE_FIELDS.filter((field) => item.fields[field] !== undefined);
        const result = await client.run(
          `INSERT INTO referees (${columns.join(', ')}, category, active)
           VALUES (${columns.map(() => '?').join(', ')}, ?, 1)
           RETURNING id`,
          [...columns.map((field) => item.fields[field] ?? null), competition]
        );
        refereeId = result.rows[0].id;
      } else if (item.action === 'update') {
        const columns = item.changes.map((change) => change.field);
        await client.run(
          `UPDATE referees
              SET ${columns.map((column) => `${column} = ?`).join(', ')}${columns.length ? ',' : ''}
                  active = 1, updated_at = iso_now()
            WHERE id = ?`,
          [...columns.map((column) => item.fields[column] ?? null), refereeId]
        );
      }

      if (item.action !== 'unchanged') {
        await client.run(
          `INSERT INTO referee_season_categories (referee_id, sport_season, category, active)
           VALUES (?, ?, ?, 1)
           ON CONFLICT (referee_id, sport_season)
           DO UPDATE SET category = excluded.category, active = 1, updated_at = iso_now()`,
          [refereeId, season, competition]
        );
        // `referees.category` è la copia denormalizzata della stagione corrente.
        if (season === currentSportSeason()) {
          await client.run('UPDATE referees SET category = ?, updated_at = iso_now() WHERE id = ?', [
            competition,
            refereeId
          ]);
        }
      }

      if (item.esordiente) {
        await client.run(
          `INSERT INTO referee_bands (referee_id, competition, sport_season, band)
           VALUES (?, ?, ?, 'esordiente')
           ON CONFLICT (referee_id, competition, sport_season, band) DO NOTHING`,
          [refereeId, competition, season]
        );
      }
    }
  });
}

// --- report ---------------------------------------------------------------

function describe(item) {
  const name = `${item.fields.last_name} ${item.fields.first_name}`;
  const license = item.fields.license_number ? `tessera ${item.fields.license_number}` : 'senza tessera';
  return `${name} (${license})${item.esordiente ? ' [esordiente]' : ''}`;
}

function printPlan({ plan, conflicts, season, competition, commit, file, sheetName, headerRow }) {
  const counts = { create: [], update: [], season: [], unchanged: [] };
  for (const item of plan) counts[item.action].push(item);

  console.log(`File: ${path.basename(file)} — foglio "${sheetName}", intestazione alla riga ${headerRow}`);
  console.log(`Campionato ${competition}, stagione ${season} — ${commit ? 'SCRITTURA' : 'ANTEPRIMA'}`);
  console.log(`Righe lette: ${plan.length + conflicts.length}\n`);

  console.log(`NUOVI (${counts.create.length})`);
  for (const item of counts.create) console.log(`  + ${describe(item)}`);

  console.log(`\nAGGIORNATI (${counts.update.length})`);
  for (const item of counts.update) {
    console.log(`  ~ ${describe(item)} — id ${item.existing.id}, trovato per ${item.matchedBy}`);
    for (const change of item.changes) {
      console.log(`      ${change.field}: ${JSON.stringify(change.from)} -> ${JSON.stringify(change.to)}`);
    }
  }

  console.log(`\nSOLO ISCRIZIONE ALLA STAGIONE (${counts.season.length})`);
  for (const item of counts.season) console.log(`  = ${describe(item)} — id ${item.existing.id}`);

  console.log(`\nGIÀ ALLINEATI (${counts.unchanged.length})`);
  for (const item of counts.unchanged) console.log(`  · ${describe(item)} — id ${item.existing.id}`);

  const esordienti = plan.filter((item) => item.esordiente);
  console.log(`\nFASCIA ESORDIENTI (${esordienti.length})`);
  for (const item of esordienti) console.log(`  * ${item.fields.last_name} ${item.fields.first_name}`);

  if (conflicts.length) {
    console.log(`\nCONFLITTI (${conflicts.length})`);
    for (const conflict of conflicts) console.log(`  ! ${conflict}`);
  }
}

// --- main -----------------------------------------------------------------

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.file) throw new Error('Indicare il file XLSX da importare.');
  const competition = clean(options.competition);
  if (!competition || competition === 'true') throw new Error('Indicare --competition=<campionato>.');
  const season = clean(options.season) && options.season !== 'true' ? clean(options.season) : currentSportSeason();
  const range = parseRowRange(options.rows);

  const known = await dbAll('SELECT value FROM competitions WHERE value = ?', [competition]);
  if (!known.length) throw new Error(`Campionato "${competition}" assente dalla tabella competitions.`);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(options.file);
  const sheetName = clean(options.sheet) && options.sheet !== 'true' ? clean(options.sheet) : '';
  const worksheet = sheetName ? workbook.getWorksheet(sheetName) : workbook.worksheets[0];
  if (!worksheet) throw new Error(`Foglio "${sheetName}" non trovato.`);

  const { headerRow, rows } = readSheet(worksheet, range, {
    esordientiColumn: parseColumn(options['esordienti-col']),
    esordientiRows: parseRowRange(options['esordienti-rows'])
  });
  const { plan, conflicts } = await buildPlan({ rows, season, competition });

  printPlan({
    plan,
    conflicts,
    season,
    competition,
    commit: options.commit,
    file: options.file,
    sheetName: worksheet.name,
    headerRow
  });

  if (conflicts.length) throw new Error('Import annullato: risolvere prima i conflitti.');
  if (!options.commit) {
    console.log('\nNessuna scrittura eseguita. Rilancia con --commit per applicare.');
    return;
  }

  await applyPlan(plan, { season, competition });
  console.log('\nImport completato in una transazione.');
}

main()
  .catch((err) => {
    console.error(`\nERRORE: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(closePool);
