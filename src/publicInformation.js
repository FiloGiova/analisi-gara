// Dati pubblici forniti dal titolare il 20 settembre 2026.
// I testi descrivono la gestione del servizio; non impostano scadenze nel database.
export const publicInformation = Object.freeze({
  operatorName: 'Filippo Giovagnini',
  contactEmail: 'filo.giova98@gmail.com',
  legalBasis: [
    'La gestione dell’account, l’autenticazione anche tramite Google e l’assistenza richiesta servono a fornire il servizio all’utente (art. 6, par. 1, lett. b, GDPR).',
    'L’organizzazione dell’attività arbitrale e la consultazione di rapporti e storico formativo si basano sul legittimo interesse del titolare e delle persone autorizzate a coordinare e documentare l’attività e a seguire la formazione, nel rispetto dei diritti delle persone coinvolte (art. 6, par. 1, lett. f, GDPR).',
    'La prevenzione degli accessi abusivi, la gestione degli incidenti e la ricostruzione delle operazioni rispondono al legittimo interesse del titolare a proteggere il servizio e i dati (art. 6, par. 1, lett. f, GDPR). Puoi opporti ai trattamenti basati sul legittimo interesse per motivi legati alla tua situazione, scrivendo al titolare.'
  ].join('\n\n'),
  retention: [
    'I dati dell’account sono conservati per la durata del rapporto di utilizzo. Il collegamento Google rimane fino allo scollegamento o alla cancellazione gestita dal titolare. Le informazioni di autenticazione conservate da Supabase richiedono una gestione separata: puoi chiederne la cancellazione allo stesso contatto indicato in questa pagina.',
    'Per anagrafiche, gare, rapporti e allegati, la durata dipende dalla stagione di riferimento, dalla continuità del percorso formativo e dalla necessità di ricostruire le attività o gestire contestazioni concrete. La chiusura di una stagione o di un account richiede quindi di valutare quali dati siano ancora necessari; quelli che non lo sono più vanno cancellati o resi anonimi.',
    'Per i registri di accesso e delle operazioni, il criterio è il tempo necessario a verificare anomalie e incidenti o ricostruire le operazioni pertinenti. Le copie di sicurezza seguono i cicli di conservazione dei servizi utilizzati e devono essere considerate nella gestione delle richieste di cancellazione. Queste verifiche e cancellazioni sono gestite dal titolare: l’app non elimina automaticamente lo storico allo scadere di un periodo fisso.'
  ].join('\n\n')
});
