// Layer di accesso a Postgres (Supabase) — API asincrona che sostituisce
// better-sqlite3. Le query usano ancora i placeholder `?` come nello SQLite:
// vengono convertiti in `$1, $2, …` di Postgres da `toPg()`. Questo tiene i
// corpi SQL quasi invariati durante la migrazione dei ~313 call-site.
//
// Mappa di conversione dai vecchi metodi sincroni:
//   getDb().prepare(SQL).get(a, b)  →  await dbGet(SQL, [a, b])
//   getDb().prepare(SQL).all(a)     →  await dbAll(SQL, [a])
//   getDb().prepare(SQL).run(a)     →  await dbRun(SQL, [a])   // vedi RETURNING
//   db.transaction(fn)()            →  await dbTx(async (client) => { … })
//
// Attenzione ai due punti che NON sono meccanici:
//   - lastInsertRowid: in Postgres si ottiene con `... RETURNING id` letto da
//     `result.rows[0].id` (dbRun restituisce { rowCount, rows }).
//   - info.changes: diventa `result.rowCount`.

import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

// better-sqlite3 restituiva COUNT()/SUM() come numeri; pg di default li dà come
// stringhe (bigint=20, numeric=1700) per non perdere precisione. Qui i valori
// sono piccoli (conteggi, voti): li riportiamo a numero per non dover cambiare
// i confronti `row.count === 0` sparsi nel codice.
pg.types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));
pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));

let pool;

export function getPool() {
  if (!pool) {
    if (!config.databaseUrl) {
      throw new Error('DATABASE_URL non configurato: impossibile connettersi a Postgres.');
    }
    pool = new Pool({
      connectionString: config.databaseUrl,
      ssl: config.databaseSsl ? { rejectUnauthorized: false } : false,
      max: config.pgPoolMax
    });
  }
  return pool;
}

// Converte i placeholder posizionali `?` in `$1, $2, …`. Nel nostro SQL il `?`
// compare solo come placeholder (nessun operatore jsonb `?` né `?` letterale).
function toPg(text) {
  let i = 0;
  return text.replace(/\?/g, () => `$${(i += 1)}`);
}

function normalizeParams(params) {
  if (params === undefined) return [];
  return Array.isArray(params) ? params : [params];
}

export async function dbAll(text, params) {
  const res = await getPool().query(toPg(text), normalizeParams(params));
  return res.rows;
}

export async function dbGet(text, params) {
  const rows = await dbAll(text, params);
  return rows[0] || null;
}

// Restituisce { rowCount, rows }. Usa `... RETURNING id` per l'id generato.
export async function dbRun(text, params) {
  const res = await getPool().query(toPg(text), normalizeParams(params));
  return { rowCount: res.rowCount, rows: res.rows };
}

// Transazione: `fn` riceve un client con gli stessi helper (query()/get()/all()/run()).
export async function dbTx(fn) {
  const client = await getPool().connect();
  const scoped = {
    all: async (text, params) => (await client.query(toPg(text), normalizeParams(params))).rows,
    get: async (text, params) => (await client.query(toPg(text), normalizeParams(params))).rows[0] || null,
    run: async (text, params) => {
      const res = await client.query(toPg(text), normalizeParams(params));
      return { rowCount: res.rowCount, rows: res.rows };
    }
  };
  try {
    await client.query('BEGIN');
    const result = await fn(scoped);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
