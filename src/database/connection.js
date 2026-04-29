import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

let db;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const schemaPath = path.join(__dirname, 'schema.sql');

export function ensureStorageDirs() {
  for (const dir of [config.storageDir, config.dataDir, config.outputDir, config.templatesDir, config.uploadsDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function getDb() {
  if (!db) {
    ensureStorageDirs();
    db = new Database(config.databasePath);
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
  }
  return db;
}

export function initializeDatabase() {
  ensureStorageDirs();
  const database = getDb();
  database.exec(fs.readFileSync(schemaPath, 'utf8'));
  return database;
}

export function closeDatabase() {
  if (db) {
    db.close();
    db = undefined;
  }
}
