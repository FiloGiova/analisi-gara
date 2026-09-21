import test from 'node:test';
import assert from 'node:assert/strict';

const cases = [
  ['endpoint REST copiato dalla dashboard', 'https://project.supabase.co/rest/v1', 'https://project.supabase.co'],
  ['endpoint REST con slash finale e spazi', ' https://project.supabase.co/rest/v1/ ', 'https://project.supabase.co'],
  ['URL del progetto già corretto', 'https://project.supabase.co', 'https://project.supabase.co'],
  ['dominio personalizzato', 'https://auth.example.test/', 'https://auth.example.test'],
  ['Supabase locale', 'http://127.0.0.1:54321/', 'http://127.0.0.1:54321'],
  ['Supabase non configurato', '', '']
];

for (const [index, [label, input, expected]] of cases.entries()) {
  test(`configurazione Supabase: ${label}`, async () => {
    const previous = process.env.SUPABASE_URL;
    try {
      process.env.SUPABASE_URL = input;
      const { config } = await import(`../src/config.js?supabase-url-test=${index}`);
      assert.equal(config.supabase.url, expected);
      if (expected) {
        // Auth e Storage devono raggiungere i propri endpoint, non la Data API.
        for (const endpoint of ['/auth/v1/authorize', '/auth/v1/token', '/auth/v1/user', '/storage/v1/object']) {
          assert.equal(new URL(`${config.supabase.url}${endpoint}`).pathname, endpoint);
        }
      }
    } finally {
      if (previous === undefined) delete process.env.SUPABASE_URL;
      else process.env.SUPABASE_URL = previous;
    }
  });
}
