const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export function publicInformationStatus(info = {}) {
  const required = ['operatorName', 'contactEmail', 'legalBasis', 'retention'];
  const missing = required.filter((key) => !String(info[key] || '').trim());
  if (info.contactEmail && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(info.contactEmail)) missing.push('validContactEmail');
  return { ready: missing.length === 0, missing };
}

function contact(info) {
  return `<a href="mailto:${escapeHtml(info.contactEmail)}">${escapeHtml(info.contactEmail)}</a>`;
}

function paragraphs(value) {
  return String(value).split(/\n\s*\n/).map((text) => `<p>${escapeHtml(text)}</p>`).join('\n');
}

function home() {
  return `<section class="public-hero" aria-labelledby="page-title">
    <div class="public-container">
      <h1 id="page-title">La stagione arbitrale,<br>tutta in un unico posto.</h1>
      <p>FischioLab riunisce gare, designazioni e rapporti arbitrali. Uno spazio di lavoro condiviso per chi organizza l’attività e segue la formazione degli arbitri.</p>
      <a class="public-button" href="/app">Accedi a FischioLab</a>
      <p class="public-hero-note">L’accesso è riservato alle persone invitate dall’amministratore.</p>
    </div>
  </section>
  <div class="public-container public-body">
    <section class="public-section" aria-labelledby="work-title">
      <h2 id="work-title">Dalla gara al confronto formativo</h2>
      <dl class="public-features">
        <div><dt>Organizzare l’attività</dt><dd>Consulta il calendario, gestisci le designazioni e ritrova le persone coinvolte in ogni gara.</dd></div>
        <div><dt>Scrivere e consultare i rapporti</dt><dd>Compila rapporti completi o a video, raccogli i feedback per ciascun arbitro e consulta lo storico.</dd></div>
        <div><dt>Seguire la stagione</dt><dd>Collega gare, valutazioni e statistiche per accompagnare il lavoro dei formatori. Ogni utente vede le informazioni previste dal proprio ruolo.</dd></div>
      </dl>
    </section>
    <section class="public-section public-access" aria-labelledby="access-title">
      <div><h2 id="access-title">Il tuo profilo parte da un invito</h2><p>L’amministratore crea il profilo e ti consegna un link personale. Aprilo per scegliere la password del tuo username oppure, se abilitato, utilizzare Google.</p><p>Email e Google sono facoltativi. Se scegli Google, il collegamento serve ad accedere al profilo già assegnato, con gli stessi ruoli e permessi.</p></div>
      <div class="public-data-note"><h3>Google per accedere</h3><p>Il login richiede le informazioni di base dell’account: identità, email e profilo. FischioLab le usa per riconoscerti e consentire l’accesso.</p><p>Non richiede l’accesso a Gmail, Drive, Calendar o ai tuoi contatti.</p><a href="/privacy">Leggi l’informativa privacy</a></div>
    </section>
  </div>`;
}

function privacy(settings) {
  const info = settings.publicInfo;
  return `<article class="public-document">
    <h1 id="page-title">Informativa privacy</h1>
    <p class="public-lead">Come FischioLab tratta i dati degli utenti e delle persone coinvolte nelle attività arbitrali, anche quando non hanno un account.</p>
    <h2>Titolare e contatti</h2><p>Il titolare del trattamento è <strong>${escapeHtml(info.operatorName)}</strong>, che gestisce personalmente FischioLab. Per informazioni sull’uso dei dati, assistenza e richieste relative ai tuoi diritti puoi scrivere a ${contact(info)}.</p>
    <h2>Dati trattati e provenienza</h2>
    <ul><li><strong>Profilo e accesso:</strong> nome, username assegnato, ruoli, associazioni alle attività, password conservata come hash e contatto email facoltativo. Il profilo iniziale viene creato dall’amministratore.</li>
    <li><strong>Attività arbitrale:</strong> anagrafiche, recapiti e foto eventualmente inseriti, gare, designazioni, disponibilità, rapporti, valutazioni, feedback e documenti caricati o esportati. I dati sono forniti dalle persone interessate, inseriti da amministratori e utenti autorizzati oppure importati da calendari e risultati pubblici FIP e da documenti federali caricati dagli utenti autorizzati.</li>
    <li><strong>Sicurezza e funzionamento:</strong> sessioni, eventi di accesso e modifica, indirizzo IP e informazioni sul browser nei registri previsti dall’app. Questi dati consentono di gestire gli accessi e ricostruire le operazioni.</li></ul>
    <h2>Accesso facoltativo con Google</h2>
    <p>Se scegli Google, Google e Supabase elaborano le informazioni di identità previste dai permessi di base: identificativo dell’account, email verificata e profilo, che può includere nome e immagine. FischioLab conserva nel proprio collegamento l’identificativo Google, quello Supabase e l’email; il nome del profilo interno e i permessi restano quelli assegnati nell’app.</p>
    <p>I dati Google vengono utilizzati per autenticarti e collegare l’account al profilo invitato. Non vengono utilizzati dall’app per pubblicità, vendita di dati o addestramento di modelli di intelligenza artificiale. Non richiediamo accesso a Gmail, Drive, Calendar o contatti. Le credenziali della tua password Google non vengono comunicate a FischioLab.</p>
    <p>Puoi usare username e password senza collegare Google. Da Account puoi scollegarlo dopo aver impostato una password alternativa; puoi inoltre revocare l’autorizzazione nelle impostazioni del tuo account Google. Lo scollegamento nell’app elimina l’associazione locale, ma non cancella automaticamente il profilo, i rapporti o l’identità conservata da Supabase.</p>
    <h2>Dati necessari e scelte facoltative</h2>
    <p>Il profilo assegnato e un metodo di autenticazione sono necessari per accedere alle funzioni riservate. Puoi attivare l’invito scegliendo soltanto una password per lo username assegnato. L’email e il collegamento Google sono facoltativi; se scegli Google, la sua email e l’identificativo sono necessari per riconoscere quell’account. Senza email puoi chiedere il recupero dell’accesso all’amministratore.</p>
    <h2>Finalità e basi giuridiche</h2>
    ${paragraphs(info.legalBasis)}
    <p>Le valutazioni nei rapporti e le decisioni su ruoli e assegnazioni spettano alle persone autorizzate. FischioLab non prende decisioni con effetti giuridici o analogamente significativi basate esclusivamente su un trattamento automatizzato.</p>
    <h2>Chi può ricevere o consultare i dati</h2>
    <p>Gli utenti autorizzati consultano i dati secondo il proprio ruolo e le assegnazioni. Gli amministratori gestiscono profili e accessi. La pubblicazione di questa informativa non rende pubblici gare, anagrafiche o rapporti.</p>
    <p>Render ospita l’applicazione; Supabase fornisce il database e, quando configurati, l’archivio dei file e l’intermediazione dell’accesso Google. Google gestisce l’autenticazione di chi sceglie tale modalità. Il fornitore email configurato dal gestore tratta i messaggi inviati tramite le funzioni email, quando abilitate, compresi i rapporti inviati ai destinatari selezionati.</p>
    ${settings.aiEnabled ? '<p>La funzione facoltativa di assistenza alla scrittura invia ad Anthropic i contenuti necessari a generare o rivedere il giudizio quando un utente autorizzato la utilizza. Il collegamento dell’account Google non viene utilizzato per questa funzione.</p>' : ''}
    <h2>Fornitori e trasferimenti internazionali</h2>
    <p>I fornitori possono trattare dati anche fuori dallo Spazio economico europeo, secondo i servizi e i luoghi di trattamento utilizzati. Le condizioni per il trattamento dei dati affidati all’infrastruttura sono descritte negli accordi di <a href="https://render.com/dpa">Render</a> e <a href="https://supabase.com/legal/customer-resources/data-processing-addendum">Supabase</a>; quest’ultimo prevede, ove applicabili, le clausole contrattuali standard della Commissione europea per i trasferimenti internazionali. Puoi chiedere al titolare informazioni sui trasferimenti del servizio e una copia delle garanzie pertinenti.</p>
    <p>Per i trattamenti descritti dai singoli fornitori consulta anche le informative di <a href="https://render.com/privacy">Render</a>, <a href="https://supabase.com/privacy">Supabase</a> e <a href="https://policies.google.com/privacy">Google</a>${settings.aiEnabled ? ', <a href="https://www.anthropic.com/legal/privacy">Anthropic</a>' : ''}.</p>
    <h2>Conservazione e cancellazione</h2>${paragraphs(info.retention)}
    <p>La disattivazione di un utente interrompe l’accesso e revoca le sessioni, conservando lo storico. Per chiedere la cancellazione scrivi a ${contact(info)}: la disattivazione e lo scollegamento Google non equivalgono alla cancellazione completa. Il titolare valuta la richiesta anche per file, dati di autenticazione, registri e copie di sicurezza e comunica eventuali motivi che richiedano di conservare parte dei dati.</p>
    <h2>Protezione dei dati e cookie</h2>
    <p>Il servizio usa HTTPS in produzione, password salvate come hash, sessioni con cookie HttpOnly e autorizzazioni per ruolo. Inviti e recuperi hanno scadenza e possono essere revocati. Il login Google usa un flusso temporaneo per verificare il ritorno dallo stesso browser.</p>
    <p>I cookie dell’app servono a mantenere la sessione e completare il login. Il cookie di sessione dura fino a ${escapeHtml(settings.sessionDays || 14)} giorni e viene rimosso con l’uscita dall’account; quello temporaneo del login Google dura fino a 10 minuti. Alcune preferenze dell’interfaccia, come filtri e colonne, vengono conservate nel browser fino alla loro modifica o alla cancellazione dei dati del sito. Queste funzioni non sono utilizzate dall’app per pubblicità o profilazione commerciale. Il passaggio sui siti Google è soggetto alle impostazioni e alle informative di Google.</p>
    <h2>Richieste e diritti</h2><p>Puoi scrivere a ${contact(info)} per chiedere informazioni, accesso, rettifica o cancellazione dei tuoi dati e, nei casi previsti dalla normativa applicabile, limitazione, opposizione e portabilità. Puoi rivolgerti all’autorità di controllo competente, in Italia il <a href="https://www.garanteprivacy.it/">Garante per la protezione dei dati personali</a>.</p>
    <h2>Aggiornamenti</h2><p>Questa pagina viene aggiornata quando cambiano il servizio o le modalità di trattamento. Ultimo aggiornamento del testo: <time datetime="2026-09-20">20 settembre 2026</time>.</p>
  </article>`;
}

function terms(info) {
  return `<article class="public-document"><h1 id="page-title">Termini di utilizzo</h1>
    <p class="public-lead">Le condizioni di utilizzo dello spazio di lavoro FischioLab.</p>
    <h2>Il servizio</h2><p>FischioLab è gestito personalmente da ${escapeHtml(info.operatorName)} per organizzare gare, designazioni, rapporti e attività formative. Per assistenza: ${contact(info)}.</p>
    <h2>Accesso su invito</h2><p>L’amministratore assegna il profilo, lo username e i permessi. Il link d’invito è personale e deve essere utilizzato dal destinatario. L’accesso Google è facoltativo e non modifica i permessi del profilo.</p>
    <h2>Credenziali e uso corretto</h2><p>Custodisci password e inviti, usa il tuo profilo e segnala accessi sospetti al gestore. Consulta e tratta le informazioni soltanto nell’ambito delle attività per cui sei autorizzato. Non condividere rapporti o dati personali con destinatari non autorizzati.</p>
    <h2>Contenuti e responsabilità operative</h2><p>Inserisci contenuti pertinenti e accurati, che sei autorizzato a trattare. Prima di finalizzare o inviare un rapporto verifica dati, valutazioni e destinatari. Anche i testi prodotti con un eventuale assistente alla scrittura richiedono la verifica dell’autore.</p>
    <h2>Gestione dell’account</h2><p>Il gestore amministra assegnazioni e accessi e può disattivare i profili. Per recuperare l’accesso senza email rivolgiti all’amministratore. La disattivazione non cancella automaticamente lo storico: consulta l’<a href="/privacy">informativa privacy</a> per le richieste sui tuoi dati.</p>
    <h2>Assistenza e aggiornamenti</h2><p>Per problemi o chiarimenti scrivi a ${contact(info)}. Ultimo aggiornamento del testo: <time datetime="2026-09-20">20 settembre 2026</time>.</p></article>`;
}

export function renderPublicPage(page, settings) {
  const info = settings.publicInfo || {};
  const status = publicInformationStatus(info);
  const ready = page === 'home' || status.ready;
  const title = page === 'privacy' ? 'Informativa privacy' : page === 'terms' ? 'Termini di utilizzo' : 'Gare, arbitri e formazione';
  const token = String(info.googleSiteVerification || '').trim();
  // Solo il valore content, non un tag HTML libero inserito da configurazione.
  const verification = /^[A-Za-z0-9_-]+$/.test(token) ? `<meta name="google-site-verification" content="${token}">` : '';
  const body = !ready ? `<article class="public-document"><h1 id="page-title">${title}</h1><p class="public-lead">Documento in preparazione.</p><p>Le informazioni del gestore devono essere completate prima della pubblicazione. Rivolgiti all’amministratore che ti ha invitato per informazioni sull’uso dei tuoi dati.</p><a href="/">Torna alla presentazione di FischioLab</a></article>` : page === 'home' ? home() : page === 'privacy' ? privacy(settings) : terms(info);
  return { ready, html: `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#123c69"><title>${title} · FischioLab</title><meta name="description" content="FischioLab: gare, designazioni, rapporti arbitrali e formazione in uno spazio di lavoro ad accesso su invito.">${verification}${!ready ? '<meta name="robots" content="noindex, nofollow">' : ''}<link rel="icon" href="/favicon.png" type="image/png"><link rel="stylesheet" href="/public-site.css">${page === 'home' ? '<script src="/public-navigation.js"></script>' : ''}</head>
    <body><a class="public-skip" href="#contenuto">Vai al contenuto</a><header class="public-header public-container"><a class="public-brand" href="/" aria-label="FischioLab, home"><img src="/app-logo.png" width="48" height="48" alt=""><span>Fischio<strong>Lab</strong></span></a><nav aria-label="Navigazione principale"><a href="/privacy"${page === 'privacy' ? ' aria-current="page"' : ''}>Privacy</a><a class="public-login" href="/app">Accedi</a></nav></header>
    <main id="contenuto">${body}</main><footer class="public-footer public-container"><span>FischioLab · Gare, arbitri e rapporti</span><nav aria-label="Informazioni"><a href="/">Home</a><a href="/privacy">Privacy</a><a href="/termini">Termini di utilizzo</a></nav></footer></body></html>` };
}
