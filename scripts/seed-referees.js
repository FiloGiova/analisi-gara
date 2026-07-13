/**
 * Import idempotente arbitri DR1 stagione 2025/2026 su Postgres.
 *
 * Uso:
 *   node scripts/seed-referees.js           # anteprima, nessuna scrittura
 *   node scripts/seed-referees.js --commit  # applica in una transazione
 */
import 'dotenv/config';
import { dbAll, dbTx, closePool } from '../src/database/db.js';

function parseDate(it) {
  if (!it) return null;
  const [d, m, y] = it.split('/');
  if (!d || !m || !y) return null;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

const SEASON = '2025/2026';
const CATEGORY = 'DR1';

const REFEREES = [
  { license: '68489', lastName: "ALI'",             firstName: 'SIMONE',           expiry: '16/07/2026', province: 'TORINO',      dob: '03/08/2006', phone: '3926668859', email: 'ali.simone2006@gmail.com' },
  { license: '67680', lastName: 'BERTELLINO',       firstName: 'NIBRET',           expiry: '26/08/2026', province: 'TORINO',      dob: '07/01/2000', phone: '3922473455', email: 'nibret.bertellino@gmail.com' },
  { license: '62181', lastName: 'BLANCATO',         firstName: 'ANDREA',           expiry: '04/09/2025', province: 'TORINO',      dob: '22/02/2002', phone: '3317709126', email: 'andreablancato.ab@gmail.com' },
  { license: '56089', lastName: 'BRACH DEL PREVER', firstName: 'EDOARDO MARIA',    expiry: '03/09/2025', province: 'CUNEO',       dob: '26/04/1996', phone: '3663714701', email: 'ebrachdelprever@gmail.com' },
  { license: '57461', lastName: 'BUSSETTI',         firstName: 'ENRICO',           expiry: '29/01/2025', province: 'ALESSANDRIA', dob: '17/05/2000', phone: '3477703226', email: 'enrico.bussetti@gmail.com' },
  { license: '58886', lastName: 'CESCHETTI',        firstName: 'SAMANTHA',         expiry: '15/09/2026', province: 'NOVARA',      dob: '09/01/1994', phone: '3463332978', email: 'sam.ceschetti@gmail.com' },
  { license: '64975', lastName: 'CHIEPPA',          firstName: 'NICOLA',           expiry: '28/08/2026', province: 'BIELLA',      dob: '21/03/1997', phone: '3491138651', email: 'chieppanicola97@gmail.com' },
  { license: '45852', lastName: 'COLPO',            firstName: 'MARCO',            expiry: '03/10/2025', province: 'BIELLA',      dob: '07/08/1978', phone: '3381781544', email: 'marcolpo@libero.it' },
  { license: '70743', lastName: 'CRISANTE',         firstName: 'EDOARDO',          expiry: '03/10/2025', province: 'TORINO',      dob: '14/07/2005', phone: '3385954646', email: 'edoardo.crisante@gmail.com' },
  { license: '70983', lastName: 'DALLE GRAVE',      firstName: 'LUCA',             expiry: '24/09/2025', province: 'TORINO',      dob: '13/02/1980', phone: '3392548286', email: 'javierlu@libero.it' },
  { license: '76134', lastName: 'DE MARTINO',       firstName: 'SAMUELE',          expiry: '25/08/2026', province: 'TORINO',      dob: '28/12/2007', phone: '3271927445', email: 'samuele.demartino@outlook.com' },
  { license: '65034', lastName: 'DELLA FORESTA',    firstName: 'LUCA PHUC',        expiry: '16/09/2026', province: 'TORINO',      dob: '05/05/2000', phone: '3334258324', email: 'lucadellaforesta@gmail.com' },
  { license: '73360', lastName: 'DI MURO',          firstName: 'PAOLO',            expiry: '03/02/2026', province: 'NOVARA',      dob: '25/01/2008', phone: '3479555982', email: 'paolodimuro08@gmail.com' },
  { license: '70117', lastName: 'EINAUDI',          firstName: 'MATTEO',           expiry: '16/09/2025', province: 'CUNEO',       dob: '10/05/2003', phone: '3703001451', email: 'matteo.einaudi@edu.unito.it' },
  { license: '72810', lastName: 'FICILI',           firstName: 'SIMONE',           expiry: '30/10/2025', province: 'TORINO',      dob: '08/05/2002', phone: '3274590642', email: 'simoneficili.sf@gmail.com' },
  { license: '72285', lastName: 'FILINGERI',        firstName: 'MARCO',            expiry: '15/09/2025', province: 'TORINO',      dob: '11/01/2004', phone: '3281270723', email: 'marco.filingeri2004@gmail.com' },
  { license: '50700', lastName: 'GENTILE',          firstName: 'TOMAS',            expiry: '18/07/2026', province: 'VERCELLI',    dob: '31/01/1996', phone: '3452618331', email: 'tomasgentile@hotmail.it' },
  { license: '65229', lastName: 'GRASSINO',         firstName: 'CLAUDIA',          expiry: '15/12/2025', province: 'TORINO',      dob: '04/08/2000', phone: '3342456371', email: 'cla.grassino.00@gmail.com' },
  { license: null,    lastName: 'GRATTACASO',       firstName: 'ANDREA',           expiry: null,         province: 'AOSTA',       dob: '08/09/2006', phone: '3293384162', email: 'grattacaso.andrea30@gmail.com' },
  { license: '70944', lastName: 'IMBERTI',          firstName: 'SIMONE',           expiry: '18/11/2025', province: 'TORINO',      dob: '14/11/2000', phone: '3276550302', email: 'simone.imberti00@gmail.com' },
  { license: '51578', lastName: 'JACAZIO',          firstName: 'GIANMARIA LAURENT',expiry: '24/10/2025', province: 'BIELLA',      dob: '03/03/1995', phone: '3470081877', email: 'gmjacazio@hotmail.com' },
  { license: '61836', lastName: 'LONARDO',          firstName: 'FRANCESCO',        expiry: '27/08/2026', province: 'ALESSANDRIA', dob: '15/11/2001', phone: '3889794015', email: 'fralona16@gmail.com' },
  { license: '62416', lastName: 'MARONE',           firstName: 'THOMAS',           expiry: '01/12/2025', province: 'TORINO',      dob: '22/05/2001', phone: '3472222453', email: 'thomasmarone.eu@gmail.com' },
  { license: '70784', lastName: 'MATTIS',           firstName: 'LORENZO',          expiry: '13/01/2026', province: 'TORINO',      dob: '27/11/2005', phone: '3924010518', email: 'mlori2005@gmail.com' },
  { license: '72818', lastName: 'MEGLIO',           firstName: 'LEONARDO',         expiry: '28/07/2026', province: 'TORINO',      dob: '30/04/2007', phone: '3934470190', email: 'meglioleonardo3@gmail.com' },
  { license: '70945', lastName: 'MERLO',            firstName: 'DAVIDE',           expiry: '18/09/2026', province: 'TORINO',      dob: '26/10/2002', phone: '3338611644', email: 'davide.merlo02@gmail.com' },
  { license: '70796', lastName: 'MESSINA',          firstName: 'MARIO CESARE',     expiry: '18/08/2025', province: 'TORINO',      dob: '21/04/2004', phone: '3474092603', email: 'mariocesaremessina21@gmail.com' },
  { license: '68392', lastName: 'MOLINARI',         firstName: 'GIORGIO',          expiry: '29/04/2026', province: 'NOVARA',      dob: '01/02/2006', phone: '3478636080', email: 'moligiorgio@gmail.com' },
  { license: '64455', lastName: 'MORATTI',          firstName: 'RICCARDO IVANO',   expiry: '08/10/2025', province: 'ALESSANDRIA', dob: '11/11/2002', phone: '3884031926', email: 'riki.ivano.moratti@gmail.com' },
  { license: '59224', lastName: 'NEBBIA',           firstName: 'EUGENIO',          expiry: '26/12/2025', province: 'ALESSANDRIA', dob: '28/07/2001', phone: '3806988352', email: 'ujnebbia28@gmail.com' },
  { license: '70947', lastName: 'NICOLA',           firstName: 'STEFANO',          expiry: '09/02/2026', province: 'CUNEO',       dob: '11/01/2003', phone: '3274184862', email: 'steu.nicola@gmail.com' },
  { license: '44493', lastName: 'NICOLELLO',        firstName: 'MARCO',            expiry: '08/01/2026', province: 'TORINO',      dob: '20/10/1989', phone: '3492248563', email: 'thebosslello@gmail.com' },
  { license: '66800', lastName: 'NICOLETTI',        firstName: 'DENNIS',           expiry: '31/07/2026', province: 'TORINO',      dob: '14/09/2002', phone: '3476596763', email: 'dennisnicoletti02@gmail.com' },
  { license: '68501', lastName: 'PANIATI',          firstName: 'GIORGIA',          expiry: '03/09/2025', province: 'TORINO',      dob: '29/02/2004', phone: '3348488345', email: 'paniatigiorgia@gmail.com' },
  { license: '77342', lastName: 'PELIZZARI',        firstName: 'ALBERTO',          expiry: '13/10/2025', province: 'ALESSANDRIA', dob: '03/03/1991', phone: '3464745408', email: 'albertopelizzari50@gmail.com' },
  { license: '44699', lastName: 'PELLEGRINI',       firstName: 'GIANLUCA',         expiry: '10/07/2025', province: 'ALESSANDRIA', dob: '13/10/1990', phone: '3451785648', email: 'gianlucapellegrini90@gmail.com' },
  { license: '64127', lastName: 'QUATTROCCHI',      firstName: 'ENRICO',           expiry: '24/09/2025', province: 'NOVARA',      dob: '19/08/2003', phone: '3319199209', email: 'enriquattro003super@gmail.com' },
  { license: '64366', lastName: 'RAZZAIO',          firstName: 'ALESSANDRO',       expiry: '03/09/2026', province: 'TORINO',      dob: '05/08/2002', phone: '3487850310', email: 'alessandro.razzaio@gmail.com' },
  { license: '78854', lastName: 'SALATINO',         firstName: 'DAVIDE',           expiry: '04/02/2026', province: 'ASTI',        dob: '17/06/1997', phone: '3669556185', email: 'davide.salatino@gmail.com' },
  { license: '69012', lastName: 'SANTAMARIA',       firstName: 'ALBERTO',          expiry: '05/11/2025', province: 'VERCELLI',    dob: '19/10/2006', phone: '3487356911', email: 'alberto.santamaria@didasca.org' },
  { license: '76950', lastName: "SANTIA'",          firstName: 'FRANCESCO',        expiry: '07/01/2026', province: 'VERCELLI',    dob: '16/08/2007', phone: '3791617763', email: 'francy.st2007@gmail.com' },
  { license: '65031', lastName: 'SANTINATO',        firstName: 'EMANUELE',         expiry: '09/01/2026', province: 'TORINO',      dob: '26/09/2002', phone: '3662915503', email: 'ema.santinato.fip@gmail.com' },
  { license: '70671', lastName: 'SCIBETTA',         firstName: "NICOLO'",          expiry: '06/08/2026', province: 'CUNEO',       dob: '26/01/2005', phone: '3890940696', email: 'scibenicolo@gmail.com' },
  { license: '70787', lastName: 'TRAFICANTE',       firstName: 'MATTEO',           expiry: '26/11/2025', province: 'TORINO',      dob: '27/06/2008', phone: '3714643135', email: 'matteo.traficante08@gmail.com' },
  { license: '59644', lastName: 'TRUCCO',           firstName: 'PAOLO',            expiry: '17/07/2026', province: 'TORINO',      dob: '23/05/2000', phone: '3801796534', email: 'paolino.trucco@gmail.com' },
  { license: '72955', lastName: 'TRUFFA',           firstName: 'JACOPO',           expiry: '27/08/2026', province: 'TORINO',      dob: '26/10/2003', phone: '3703147552', email: 'jacotruffa14@gmail.com' },
  { license: '65020', lastName: 'VECA',             firstName: 'ALESSANDRO',       expiry: '19/02/2026', province: 'TORINO',      dob: '06/05/2004', phone: '3318963332', email: 'alessandro.veca.02056@gmail.com' },
  { license: '67438', lastName: 'VENTURI',          firstName: 'JACOPO',           expiry: '01/09/2026', province: 'TORINO',      dob: '02/10/2003', phone: '3661438604', email: 'vventurijacopo@gmail.com' },
];

const commit = process.argv.includes('--commit');

function clean(value) {
  return String(value || '').trim();
}

function nameKey(firstName, lastName) {
  return `${clean(lastName).toLocaleLowerCase('it')}|${clean(firstName).toLocaleLowerCase('it')}`;
}

function sameNullable(left, right) {
  return clean(left) === clean(right);
}

function expectedFields(referee) {
  return {
    license_number: referee.license || null,
    first_name: referee.firstName,
    last_name: referee.lastName,
    birth_date: parseDate(referee.dob),
    email: referee.email || null,
    phone: referee.phone || null,
    province: referee.province || null,
    certificate_expiry: parseDate(referee.expiry)
  };
}

function needsUpdate(existing, expected) {
  return Object.entries(expected).some(([field, value]) => !sameNullable(existing[field], value)) || Number(existing.active) !== 1;
}

async function buildPlan() {
  const existingRows = await dbAll(
    `SELECT r.*,
            sc.category AS season_category,
            sc.active AS season_active
       FROM referees r
       LEFT JOIN referee_season_categories sc
         ON sc.referee_id = r.id AND sc.sport_season = ?`,
    [SEASON]
  );

  const byLicense = new Map();
  const byName = new Map();
  for (const row of existingRows) {
    if (clean(row.license_number)) {
      const matches = byLicense.get(clean(row.license_number)) || [];
      matches.push(row);
      byLicense.set(clean(row.license_number), matches);
    }
    const key = nameKey(row.first_name, row.last_name);
    const matches = byName.get(key) || [];
    matches.push(row);
    byName.set(key, matches);
  }

  const inputLicenses = new Set();
  const inputNames = new Set();
  const conflicts = [];
  const plan = [];

  for (const referee of REFEREES) {
    const license = clean(referee.license);
    const key = nameKey(referee.firstName, referee.lastName);
    if (license && inputLicenses.has(license)) conflicts.push(`Tessera duplicata nell'elenco: ${license}`);
    if (inputNames.has(key)) conflicts.push(`Nominativo duplicato nell'elenco: ${referee.lastName} ${referee.firstName}`);
    if (license) inputLicenses.add(license);
    inputNames.add(key);

    const licenseMatches = license ? (byLicense.get(license) || []) : [];
    const nameMatches = byName.get(key) || [];
    if (licenseMatches.length > 1 || nameMatches.length > 1) {
      conflicts.push(`Più corrispondenze nel DB per ${referee.lastName} ${referee.firstName}.`);
      continue;
    }

    const byLicenseRow = licenseMatches[0] || null;
    const byNameRow = nameMatches[0] || null;
    if (byLicenseRow && byNameRow && byLicenseRow.id !== byNameRow.id) {
      conflicts.push(`Tessera e nominativo puntano a due arbitri diversi per ${referee.lastName} ${referee.firstName}.`);
      continue;
    }

    const existing = byLicenseRow || byNameRow;
    const expected = expectedFields(referee);
    const rosterReady =
      existing && existing.season_category === CATEGORY && Number(existing.season_active) === 1;
    plan.push({
      referee,
      expected,
      existing,
      action: !existing ? 'create' : needsUpdate(existing, expected) ? 'update' : rosterReady ? 'unchanged' : 'roster'
    });
  }

  return { plan, conflicts };
}

async function applyPlan(plan) {
  await dbTx(async (client) => {
    for (const item of plan) {
      let refereeId = item.existing?.id;
      const values = Object.values(item.expected);

      if (!refereeId) {
        const result = await client.run(
          `INSERT INTO referees
             (license_number, first_name, last_name, birth_date, email, phone, province, certificate_expiry, category, active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 1)
           RETURNING id`,
          values
        );
        refereeId = result.rows[0].id;
      } else if (item.action === 'update') {
        await client.run(
          `UPDATE referees
              SET license_number = ?, first_name = ?, last_name = ?, birth_date = ?, email = ?, phone = ?,
                  province = ?, certificate_expiry = ?, active = 1, updated_at = iso_now()
            WHERE id = ?`,
          [...values, refereeId]
        );
      }

      if (item.action !== 'unchanged') {
        await client.run(
          `INSERT INTO referee_season_categories (referee_id, sport_season, category, active)
           VALUES (?, ?, ?, 1)
           ON CONFLICT (referee_id, sport_season)
           DO UPDATE SET category = excluded.category, active = 1, updated_at = iso_now()`,
          [refereeId, SEASON, CATEGORY]
        );
      }
    }
  });
}

async function main() {
  const { plan, conflicts } = await buildPlan();
  const counts = Object.fromEntries(
    ['create', 'update', 'roster', 'unchanged'].map((action) => [
      action,
      plan.filter((item) => item.action === action).length
    ])
  );

  console.log(`Import ${CATEGORY} ${SEASON} — ${commit ? 'COMMIT' : 'ANTEPRIMA'}`);
  console.log(`Righe valide: ${REFEREES.length}`);
  console.log(`Da creare: ${counts.create}`);
  console.log(`Da aggiornare: ${counts.update}`);
  console.log(`Solo appartenenza stagionale: ${counts.roster}`);
  console.log(`Già allineati: ${counts.unchanged}`);

  if (conflicts.length) {
    console.error(`Conflitti: ${conflicts.length}`);
    for (const conflict of conflicts) console.error(`- ${conflict}`);
    throw new Error('Import annullato: risolvere i conflitti prima di procedere.');
  }

  if (!commit) {
    console.log('Nessuna scrittura eseguita. Rilancia con --commit per applicare.');
    return;
  }

  await applyPlan(plan);
  console.log('Import completato in una transazione.');
}

main()
  .catch((err) => {
    console.error(`ERRORE: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(closePool);
