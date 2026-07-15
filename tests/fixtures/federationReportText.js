export function federationReportText({
  target = 'ROSSI MARIO',
  vote = '68',
  potential = 'Alta',
  errors = '',
  observer = 'VERDI LUCA',
  matchDate = '17/11/2025',
  evaluationDate = '18/11/2025',
  matchNumber = '341',
  firstReferee = 'ROSSI MARIO',
  secondReferee = 'BIANCHI ANNA',
  teamHome = 'SQUADRA CASA',
  teamAway = 'SQUADRA OSPITE',
  scoreHome = '76',
  scoreAway = '65'
} = {}) {
  return `
RAPPORTO PRESTAZIONE ARBITRALE
VALUTATORE:DATA:${observer}${evaluationDate}
1° ARBITRO:
2° ARBITRO:
${firstReferee}
${matchDate}
3° ARBITRO:
${teamHome}
GARA NUMERO:
DEL
SQUADRE:
${secondReferee}
CITTA (PR)
${teamAway}
${scoreHome} - ${scoreAway}
GIOCATA A:
vs
CAMPIONATO:
Divisione regionale 1
${matchNumber}
RIS. FINALE:
ARBITRO:${target}
VERSIONE COMPLETA
1 CARATTERISTICHE DELLA GARA
Difficoltà ambientale / Complessità tecnica
Normale
Note
Gara lineare.
2 STATO DI FORMA / ATLETISMO
Continuità / Reattività / Velocità nelle transizioni
Standard
Note
Buona condizione.
3 CONDUZIONE
3.1 Leadership / Assunzione di responsabilità
Di qualità
3.2 Lavoro di squadra
Standard
3.3 Metro di valutazione
Migliorabile
Note
Conduzione coerente.
4 DISCIPLINA E RAPPORTI CON L'AMBIENTE
4.1 Anticipazione problemi
Standard
4.2 Corretto uso ed efficacia dei provvedimenti
Non valutabile
Note
Nessun problema disciplinare.
5 TECNICA
5.1.1 Passi
Standard
5.1.2 Regole a tempo
Di qualità
5.1.3 Altre violazioni
Standard
5.2.1 Atto di tiro
Standard
5.2.2 Responsabilità contatti
Migliorabile
5.3.1 Rimbalzo
Standard
5.3.2 Blocchi / Tagli
Standard
5.4 FALLO ANTISPORTIVO
Non valutabile
5.5 SIMULAZIONI
Non valutabile
Note
Tecnica da consolidare.
6 AMMINISTRAZIONE DEL GIOCO
Controllo cronometri
Standard
7 COMUNICAZIONE
Segnali FIBA
Di qualità
8 MECCANICA
8.1 Lettura del gioco
Standard
8.2 Rispetto competenze
Standard
Note
Buona ricerca della posizione.
9 CONCLUSIONI
BREVE COMMENTO FINALE
Indicare eventuali punti di forza ed aree di miglioramento
Punti di forza: presenza.
Aree di miglioramento: continuità.
EVENTUALI ERRORI TECNICI
Indicare tipo di errore e riferimento tempo di gioco
${errors}
POTENZIALITA'
${potential}
Motivazione
Percorso di crescita positivo.
VOTO
${vote}
Pagina 7 di 7
28/11/2025 02:17Data stampa:
`;
}
