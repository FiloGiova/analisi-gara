import { initializeDatabase } from '../src/database/connection.js';
import { countUsers, upsertUser } from '../src/services/userService.js';
import { createRandomPassword } from '../src/utils/passwords.js';
import { config } from '../src/config.js';

initializeDatabase();

console.log(`Directory storage: ${config.storageDir}`);
console.log(`Database SQLite: ${config.databasePath}`);

if (countUsers() === 0) {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || createRandomPassword();
  const displayName = process.env.ADMIN_DISPLAY_NAME || 'Amministratore';
  upsertUser({ username, password, displayName, role: 'admin' });

  console.log('');
  console.log('Utente admin iniziale creato.');
  console.log(`Username: ${username}`);
  console.log(`Password: ${password}`);
  if (!process.env.ADMIN_PASSWORD) {
    console.log('Salva questa password: viene mostrata solo ora.');
  }
} else {
  console.log('Database gia inizializzato: utenti presenti, nessun admin creato.');
}
