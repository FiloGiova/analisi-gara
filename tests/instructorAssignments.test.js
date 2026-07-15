import test from 'node:test';
import assert from 'node:assert/strict';

const { setupTestDatabase, closeTestDatabase, insertId, dbAll } = await import('./helpers/testDatabase.js');
const { createUser, updateUser } = await import('../src/services/userService.js');
const { listReports } = await import('../src/services/reportService.js');
const { instructorCompetitionsForSeason } = await import('../shared/instructorAssignments.js');
const { currentSportSeason } = await import('../shared/reportTemplate.js');
const { initializeDatabase } = await import('../src/database/connection.js');

await setupTestDatabase();

test.after(async () => {
  await closeTestDatabase();
});

test('le assegnazioni formatore vengono salvate e risolte per stagione', async () => {
  const instructor = await createUser({
    username: 'storico.formatore',
    password: 'password-sicura',
    displayName: 'Formatore Storico',
    role: 'instructor',
    instructorAssignments: [
      { sportSeason: '2025/2026', competitions: ['DR1'] },
      { sportSeason: '2026/2027', competitions: ['Serie C'] }
    ]
  });

  assert.deepEqual(instructorCompetitionsForSeason(instructor, '2025/2026'), ['DR1']);
  assert.deepEqual(instructorCompetitionsForSeason(instructor, '2026/2027'), ['Serie C']);
  assert.deepEqual(instructorCompetitionsForSeason(instructor, '2024/2025'), []);

  const reportIds = {};
  for (const [key, season, competition] of [
    ['oldAllowed', '2025/2026', 'DR1'],
    ['oldDenied', '2025/2026', 'Serie C'],
    ['newAllowed', '2026/2027', 'Serie C'],
    ['newDenied', '2026/2027', 'DR1']
  ]) {
    reportIds[key] = await insertId(
      `INSERT INTO reports (
         status, observer_name, report_date, match_number, competition,
         team_home, team_away, sport_season, payload_json
       ) VALUES ('draft', 'Osservatore', ?, ?, ?, 'A', 'B', ?, '{}')`,
      [season === '2025/2026' ? '2026-01-10' : '2026-10-10', key, competition, season]
    );
  }

  const visible = new Set((await listReports({ user: instructor })).map((report) => report.id));
  assert.ok(visible.has(reportIds.oldAllowed));
  assert.ok(visible.has(reportIds.newAllowed));
  assert.ok(!visible.has(reportIds.oldDenied));
  assert.ok(!visible.has(reportIds.newDenied));

  const updated = await updateUser({
    id: instructor.id,
    displayName: instructor.displayName,
    role: 'instructor',
    active: true,
    instructorAssignments: [
      { sportSeason: '2025/2026', competitions: ['DR1'] },
      { sportSeason: '2026/2027', competitions: ['DR1', 'Serie C'] }
    ]
  });
  assert.deepEqual(
    instructorCompetitionsForSeason(updated, '2026/2027').sort(),
    ['DR1', 'Serie C']
  );
  const stored = await dbAll(
    `SELECT sport_season, competition
       FROM instructor_competition_assignments
      WHERE user_id = ?
      ORDER BY sport_season, competition`,
    [instructor.id]
  );
  assert.deepEqual(stored, [
    { sport_season: '2025/2026', competition: 'DR1' },
    { sport_season: '2026/2027', competition: 'DR1' },
    { sport_season: '2026/2027', competition: 'Serie C' }
  ]);
});

test('un formatore richiede almeno una assegnazione completa', async () => {
  await assert.rejects(
    () => createUser({
      username: 'senza.stagione',
      password: 'password-sicura',
      role: 'instructor',
      instructorAssignments: []
    }),
    /almeno una stagione/
  );
});

test('la migrazione conserva il vecchio perimetro su tutte le stagioni già presenti', async () => {
  const legacyUserId = await insertId(
    `INSERT INTO users (username, password_hash, display_name, role, formatter_competition)
     VALUES ('formatore.legacy', 'x', 'Formatore Legacy', 'instructor', ?)`,
    [JSON.stringify(['DR1'])]
  );
  await insertId(
    `INSERT INTO games (sport_season, match_number, competition, team_home, team_away)
     VALUES ('2024/2025', 'legacy-1', 'DR1', 'A', 'B')`
  );

  await initializeDatabase();

  const rows = await dbAll(
    `SELECT sport_season, competition
       FROM instructor_competition_assignments
      WHERE user_id = ?
      ORDER BY sport_season`,
    [legacyUserId]
  );
  const migratedSeasons = new Set(rows.map((row) => row.sport_season));
  assert.ok(migratedSeasons.has('2024/2025'));
  assert.ok(migratedSeasons.has(currentSportSeason()));
  assert.ok(rows.every((row) => row.competition === 'DR1'));
});
