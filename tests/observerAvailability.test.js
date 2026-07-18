import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fischiolab-observer-availability-'));
process.env.STORAGE_DIR = tempDir;

const { setupTestDatabase, closeTestDatabase, insertId } = await import('./helpers/testDatabase.js');
const {
  createObserverAvailability,
  deleteObserverAvailability,
  getObserverAvailabilityProfile,
  availabilityForObserverOnDate,
  availabilityRangesByObserver
} = await import('../src/services/observerAvailabilityService.js');
const { createGame, setOfficial } = await import('../src/services/gameService.js');
const { getObserverSuggestions } = await import('../src/services/statsService.js');

await setupTestDatabase();

const SEASON = '2025/2026';
const adminId = await insertId(
  "INSERT INTO users (username, password_hash, display_name, role) VALUES ('admin-av', 'x', 'Admin', 'admin')"
);
const instructorId = await insertId(
  "INSERT INTO users (username, password_hash, display_name, role) VALUES ('formatore-av', 'x', 'Formatore', 'instructor')"
);
const observerAId = await insertId(
  "INSERT INTO users (username, password_hash, display_name, role) VALUES ('osservatore-a', 'x', 'Anna Osservatrice', 'observer')"
);
const observerBId = await insertId(
  "INSERT INTO users (username, password_hash, display_name, role) VALUES ('osservatore-b', 'x', 'Bruno Osservatore', 'observer')"
);
const admin = { id: adminId, role: 'admin' };
const instructor = { id: instructorId, role: 'instructor' };
const observerA = { id: observerAId, role: 'observer' };
const observerB = { id: observerBId, role: 'observer' };

const ref1 = await insertId("INSERT INTO referees (first_name, last_name) VALUES ('Aria', 'Prima')");
const ref2 = await insertId("INSERT INTO referees (first_name, last_name) VALUES ('Berto', 'Secondo')");
const game = await createGame({
  data: {
    sportSeason: SEASON,
    matchNumber: '009901',
    teamHome: 'Casa',
    teamAway: 'Ospiti',
    scheduledAt: '2026-02-14T20:30'
  },
  user: admin,
  source: 'manual'
});
await setOfficial(game.id, { role: 'referee1', refereeId: ref1, source: 'manual' }, { user: admin });
await setOfficial(game.id, { role: 'referee2', refereeId: ref2, source: 'manual' }, { user: admin });

const mainAvailability = await createObserverAvailability({
  observerId: observerAId,
  actor: observerA,
  startDate: '2026-02-13',
  endDate: '2026-02-15',
  note: 'Impegno personale'
});

test.after(async () => {
  await closeTestDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('un osservatore inserisce un periodo personale non legato alla stagione', async () => {
  assert.equal(mainAvailability.userId, observerAId);
  assert.equal(mainAvailability.startDate, '2026-02-13');
  assert.equal(mainAvailability.endDate, '2026-02-15');
  assert.equal(mainAvailability.createdBy, observerAId);

  const profile = await getObserverAvailabilityProfile({ observerId: observerAId, actor: observerA });
  assert.equal(profile.observer.displayName, 'Anna Osservatrice');
  assert.deepEqual(profile.unavailabilities.map((item) => item.note), ['Impegno personale']);

  const onGameDay = await availabilityForObserverOnDate(observerAId, '2026-02-14T20:30');
  assert.equal(onGameDay.id, mainAvailability.id);
  assert.equal(await availabilityForObserverOnDate(observerAId, '2026-02-16'), null);
});

test('admin e formatori gestiscono gli osservatori, un altro osservatore no', async () => {
  const insertedByInstructor = await createObserverAvailability({
    observerId: observerBId,
    actor: instructor,
    startDate: '2026-03-01',
    endDate: '2026-03-01'
  });
  assert.equal(insertedByInstructor.createdBy, instructorId);

  await assert.rejects(
    () => createObserverAvailability({
      observerId: observerBId,
      actor: observerA,
      startDate: '2026-03-02',
      endDate: '2026-03-02'
    }),
    /Non puoi gestire/
  );

  await assert.doesNotReject(() => getObserverAvailabilityProfile({ observerId: observerBId, actor: admin }));
  await deleteObserverAvailability({ availabilityId: insertedByInstructor.id, actor: admin });
  assert.equal(await availabilityForObserverOnDate(observerBId, '2026-03-01'), null);
});

test('periodi sovrapposti e intervalli non validi vengono rifiutati', async () => {
  await assert.rejects(
    () => createObserverAvailability({
      observerId: observerAId,
      actor: admin,
      startDate: '2026-02-15',
      endDate: '2026-02-18'
    }),
    /comprende almeno uno/
  );
  await assert.rejects(
    () => createObserverAvailability({
      observerId: observerAId,
      actor: admin,
      startDate: '2026-04-02',
      endDate: '2026-04-01'
    }),
    /non può precedere/
  );
});

test('le indisponibilità sono esposte ai selettori per data', async () => {
  const ranges = await availabilityRangesByObserver([observerAId, observerBId]);
  assert.deepEqual(ranges.get(observerAId), [{
    id: mainAvailability.id,
    startDate: '2026-02-13',
    endDate: '2026-02-15'
  }]);
  assert.deepEqual(ranges.get(observerBId), []);
});

test('il suggeritore marca e mette in fondo gli indisponibili', async () => {
  const suggestions = await getObserverSuggestions({ gameId: game.id });
  const unavailable = suggestions.find((item) => item.userId === observerAId);
  const available = suggestions.find((item) => item.userId === observerBId);
  assert.equal(unavailable.unavailable, true);
  assert.equal(unavailable.unavailability.id, mainAvailability.id);
  assert.match(unavailable.reasons[0], /Indisponibile/);
  assert.equal(available.unavailable, false);
  assert.ok(suggestions.indexOf(unavailable) > suggestions.indexOf(available));
});

test('la designazione lato server rifiuta un osservatore indisponibile', async () => {
  await assert.rejects(
    () => setOfficial(game.id, { role: 'observer', userId: observerAId, source: 'manual' }, { user: admin }),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.details?.code, 'OBSERVER_UNAVAILABLE');
      assert.equal(error.details?.unavailability?.id, mainAvailability.id);
      return true;
    }
  );
  await assert.doesNotReject(
    () => setOfficial(game.id, { role: 'observer', userId: observerBId, source: 'manual' }, { user: admin })
  );
});
