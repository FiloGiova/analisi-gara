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

CREATE TABLE IF NOT EXISTS access_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  ip_address  TEXT,
  user_agent  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
