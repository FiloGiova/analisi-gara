import { initializeDatabase, closeDatabase } from '../src/database/connection.js';
import { upsertUser } from '../src/services/userService.js';

const username = process.argv[2] || process.env.ADMIN_USERNAME || 'admin';
const password = process.argv[3] || process.env.ADMIN_PASSWORD;
const displayName = process.env.ADMIN_DISPLAY_NAME || username;

if (!password) {
  console.error('Password mancante. Usa: ADMIN_PASSWORD="nuova-password" npm run seed:admin');
  console.error('Oppure: node scripts/create-admin.js admin "nuova-password"');
  process.exit(1);
}

await initializeDatabase();
await upsertUser({ username, password, displayName, role: 'admin' });
console.log(`Utente admin "${username}" creato/aggiornato.`);
await closeDatabase();
