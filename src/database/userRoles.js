import { ROLES } from '../../shared/permissions.js';

// I ruoli di un utente vivono in `user_roles`. `users.role` resta come ruolo
// principale (compatibilità con il codice e i dati storici), quindi le query
// che selezionano utenti per ruolo devono guardare la tabella e ricadere sulla
// colonna solo per le righe non ancora migrate — è il caso degli utenti creati
// direttamente via SQL, per esempio nei test.
export function hasAnyRoleSql(alias, roles) {
  const wanted = roles.filter((role) => ROLES.includes(role));
  if (!wanted.length) return '1=0';
  const list = wanted.map((role) => `'${role}'`).join(', ');
  return `(
    EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = ${alias}.id AND ur.role IN (${list}))
    OR (
      NOT EXISTS (SELECT 1 FROM user_roles ur_any WHERE ur_any.user_id = ${alias}.id)
      AND ${alias}.role IN (${list})
    )
  )`;
}

// Negazione della precedente: "l'utente non ha nessuno di questi ruoli".
export function lacksAllRolesSql(alias, roles) {
  return `NOT ${hasAnyRoleSql(alias, roles)}`;
}
