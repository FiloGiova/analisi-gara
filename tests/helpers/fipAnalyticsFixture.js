// Gare sintetiche con la stessa forma delle risposte di FIP Analytics
// (POST /api/gare/search). Nomi e dati anagrafici inventati: i campi personali
// (codice fiscale, telefono, email) ci sono apposta, per verificare che il
// sync non li porti mai fuori dall'adapter.

let designationTime = 0;

export function designazione({ ruolo, cognome, nome, tessera, stato, modificata = null }) {
  designationTime += 1;
  return {
    cod_tessera: tessera,
    cod_ruolo: ruolo,
    dat_ultima_modifica: modificata || `2026-09-2${Math.min(9, designationTime % 10)}T10:00:${String(designationTime % 60).padStart(2, '0')}`,
    stato: { stato_designazione: stato, des_stato: stato },
    tessera: {
      cod_tessera: tessera,
      tesserato: {
        cognome,
        nome,
        cf: 'XXXYYY00A00Z000X',
        cellulare: '3330000000',
        mail: `${cognome.toLowerCase()}@example.invalid`,
        dat_nascita: '1990-01-01'
      }
    }
  };
}

export function gara({
  num,
  date = '2026-10-03',
  time = '18:00:00',
  giornata = 1,
  tipo = 'Andata',
  fase = 'Qualificazione',
  girone = 'Girone A',
  campionato = 'D',
  casa = 'CASA TEST',
  ospite = 'OSPITE TEST',
  campo = { nome: 'PALESTRA TEST', indirizzo: 'Via Roma 1', cap: '10100', comune: 'Torino', provincia: 'TO' },
  designazioni = [],
  eliminata = false
}) {
  return {
    id: 100000 + num,
    num_gara: num,
    cod_stagione: '2026_27',
    dat_gara: date,
    ora_gara: time,
    des_fase: fase,
    des_campionato: campionato === 'D' ? 'Divisione regionale 1' : 'Serie C',
    cod_campionato: campionato,
    des_girone: girone,
    num_giornata: giornata,
    des_tipo_giornata: tipo,
    flg_deleted: eliminata,
    squadra_a: { des_squadra: casa },
    squadra_b: { des_squadra: ospite },
    campo: campo
      ? {
          des_campo: campo.nome,
          des_indirizzo: campo.indirizzo,
          des_cap: campo.cap,
          comune: { des_comune: campo.comune, cod_provincia: campo.provincia }
        }
      : null,
    designazioni
  };
}

// fetch finto per l'API: login con token e ricerca gare. `state.items` si
// cambia da un test all'altro; `state.calls` registra le richieste.
export function analyticsFetch(state) {
  return async (url, options = {}) => {
    const path = new URL(url).pathname.replace(/^\/api/, '');
    state.calls.push({ method: options.method, path, headers: options.headers || {}, body: options.body });
    const reply = (status, data) => ({ ok: status >= 200 && status < 300, status, url, text: async () => JSON.stringify(data) });

    if (path === '/auth/login') {
      if (state.loginResponse) return reply(...state.loginResponse);
      return reply(200, { access_token: 'token-di-prova', token_type: 'bearer', user_data: {} });
    }
    if (options.headers?.Authorization !== 'Bearer token-di-prova') {
      return reply(401, { detail: 'Not authenticated' });
    }
    if (path === '/gare/search') {
      const body = JSON.parse(options.body || '{}');
      const codes = body.search?.cod_campionato || [];
      const matching = state.items.filter((item) => !codes.length || codes.includes(item.cod_campionato));
      return reply(200, { items: matching.slice(body.skip || 0, (body.skip || 0) + (body.limit || 100)), total: matching.length });
    }
    if (path === '/gare/filtri') {
      return reply(200, { campionati: [{ cod: 'C1', des: 'Serie C' }, { cod: 'D', des: 'Divisione regionale 1' }] });
    }
    return reply(404, { detail: 'Not Found' });
  };
}
