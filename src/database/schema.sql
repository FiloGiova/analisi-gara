CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'observer',
  formatter_competition TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  photo_path TEXT,
  referee_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS instructor_competition_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  sport_season TEXT NOT NULL,
  competition TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, sport_season, competition),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'final')),
  observer_name TEXT NOT NULL DEFAULT '',
  report_date TEXT NOT NULL DEFAULT '',
  match_number TEXT NOT NULL DEFAULT '',
  competition TEXT NOT NULL DEFAULT '',
  team_home TEXT NOT NULL DEFAULT '',
  team_away TEXT NOT NULL DEFAULT '',
  score_home TEXT NOT NULL DEFAULT '',
  score_away TEXT NOT NULL DEFAULT '',
  sport_season TEXT,
  first_referee_id INTEGER,
  first_referee_name TEXT NOT NULL DEFAULT '',
  second_referee_id INTEGER,
  second_referee_name TEXT NOT NULL DEFAULT '',
  first_referee_vote TEXT,
  second_referee_vote TEXT,
  payload_json TEXT NOT NULL,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finalized_at TEXT,
  first_referee_sent_at TEXT,
  second_referee_sent_at TEXT,
  FOREIGN KEY (first_referee_id) REFERENCES referees(id) ON DELETE SET NULL,
  FOREIGN KEY (second_referee_id) REFERENCES referees(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS exports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL,
  referee_role TEXT NOT NULL CHECK (referee_role IN ('first', 'second')),
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS referees (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  license_number      TEXT,
  first_name          TEXT NOT NULL,
  last_name           TEXT NOT NULL,
  birth_date          TEXT,
  email               TEXT,
  phone               TEXT,
  province            TEXT,
  certificate_expiry  TEXT,
  category            TEXT,
  notes               TEXT,
  photo_path          TEXT,
  active              INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS referee_rosters (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  referee_id   INTEGER NOT NULL,
  competition  TEXT NOT NULL,
  sport_season TEXT NOT NULL,
  UNIQUE(referee_id, competition, sport_season),
  FOREIGN KEY (referee_id) REFERENCES referees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS referee_season_categories (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  referee_id   INTEGER NOT NULL,
  sport_season TEXT NOT NULL,
  category     TEXT,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE(referee_id, sport_season),
  FOREIGN KEY (referee_id) REFERENCES referees(id) ON DELETE CASCADE
);

-- Fasce/liste arbitri per campionato e stagione (esordienti, playoff, playout).
CREATE TABLE IF NOT EXISTS referee_bands (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  referee_id   INTEGER NOT NULL,
  competition  TEXT NOT NULL,
  sport_season TEXT NOT NULL,
  band         TEXT NOT NULL CHECK (band IN ('esordiente', 'playoff', 'playout')),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE(referee_id, competition, sport_season, band),
  FOREIGN KEY (referee_id) REFERENCES referees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS access_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  ip_address  TEXT,
  user_agent  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS competition_sources (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  sport_season     TEXT NOT NULL,
  name             TEXT NOT NULL,
  source_type      TEXT NOT NULL DEFAULT 'fip_public' CHECK (source_type IN ('fip_public')),
  url              TEXT NOT NULL,
  params_json      TEXT,
  competition      TEXT,
  active           INTEGER NOT NULL DEFAULT 1,
  last_synced_at   TEXT,
  last_sync_status TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS games (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  sport_season          TEXT NOT NULL,
  competition_source_id INTEGER,
  external_source       TEXT NOT NULL DEFAULT 'manual' CHECK (external_source IN ('fip_public', 'xlsx', 'manual')),
  match_number          TEXT NOT NULL,
  competition           TEXT,
  phase                 TEXT,
  girone                TEXT,
  matchday              INTEGER,
  leg                   TEXT CHECK (leg IN ('andata', 'ritorno')),
  scheduled_at          TEXT,
  team_home             TEXT NOT NULL DEFAULT '',
  team_away             TEXT NOT NULL DEFAULT '',
  venue                 TEXT,
  status                TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'played', 'postponed', 'cancelled')),
  score_home            TEXT,
  score_away            TEXT,
  notes                 TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  last_synced_at        TEXT,
  UNIQUE (sport_season, match_number),
  FOREIGN KEY (competition_source_id) REFERENCES competition_sources(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS game_officials (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id       INTEGER NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('referee1', 'referee2', 'referee3', 'observer')),
  referee_id    INTEGER,
  user_id       INTEGER,
  external_name TEXT NOT NULL DEFAULT '',
  source        TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('fip_public', 'xlsx', 'federation_pdf', 'manual')),
  status        TEXT NOT NULL DEFAULT 'provisional' CHECK (status IN ('provisional', 'confirmed')),
  manual_lock   INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (game_id, role),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  FOREIGN KEY (referee_id) REFERENCES referees(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS person_aliases (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source          TEXT NOT NULL,
  external_name   TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  referee_id      INTEGER,
  user_id         INTEGER,
  verified_by     INTEGER,
  verified_at     TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (source, normalized_name),
  FOREIGN KEY (referee_id) REFERENCES referees(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  type                  TEXT NOT NULL DEFAULT 'fip_sync' CHECK (type IN ('fip_sync', 'xlsx_import', 'pdf_report_import')),
  competition_source_id INTEGER,
  started_by            INTEGER,
  started_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  finished_at           TEXT,
  status                TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'partial', 'error')),
  created_count         INTEGER NOT NULL DEFAULT 0,
  updated_count         INTEGER NOT NULL DEFAULT 0,
  conflict_count        INTEGER NOT NULL DEFAULT 0,
  error_count           INTEGER NOT NULL DEFAULT 0,
  summary_json          TEXT,
  FOREIGN KEY (competition_source_id) REFERENCES competition_sources(id) ON DELETE SET NULL,
  FOREIGN KEY (started_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS scheduled_jobs (
  job_name      TEXT PRIMARY KEY,
  last_run_key  TEXT,
  status        TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'running', 'success', 'partial', 'error')),
  started_at    TEXT,
  finished_at   TEXT,
  summary_json  TEXT,
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS game_changes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id     INTEGER NOT NULL,
  field       TEXT NOT NULL,
  old_value   TEXT,
  new_value   TEXT,
  source      TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('fip_public', 'xlsx', 'federation_pdf', 'manual')),
  changed_by  INTEGER,
  sync_run_id INTEGER,
  reason      TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (sync_run_id) REFERENCES sync_runs(id) ON DELETE SET NULL
);
