# FischioLab Design System

## Overview

FischioLab è una web app operativa mobile-first. Il design deve sembrare un unico prodotto: superfici chiare e dense, hero scuri per orientamento, componenti familiari, stati semantici riconoscibili e pochissima decorazione non funzionale.

## Design tokens

La fonte autorevole dei token è `client/src/styles.css`. Nuovi componenti devono riusare le custom property esistenti invece di introdurre valori isolati.

### Color

- Testo: `--ink`, `--ink-soft`, `--muted`.
- Superfici: `--paper`, `--paper-2`, `--surface`, `--surface-soft`.
- Bordi: `--line`, `--line-soft`.
- Azioni e informazione: `--blue`, `--teal` e le rispettive varianti soft.
- Stati: `--final`, `--draft`, `--danger`, `--warning` con fondo, testo e bordo dedicati.
- Il colore di accento indica azione, selezione o stato; non è decorazione.

### Typography

- Famiglia unica: Montserrat con fallback Aptos/Trebuchet MS/sans-serif.
- Scala fissa tramite `--fs-h1` … `--fs-xs`, con riduzione mobile già definita.
- Titoli brevi e bilanciati; testo di supporto concreto e leggibile.
- Numeri gara e dati tabellari usano cifre tabulari o monospace solo quando migliora la scansione.

### Spacing and shape

- Scala base 4 px: `--space-1` … `--space-8`.
- Raggi: 8 px per elementi compatti, 12–16 px per superfici, pill solo per badge e pulsanti.
- Controlli alti 44 px (`--control-h`), 42 px su mobile; i target touch non devono scendere sotto questa misura.
- Ombre leggere definite da `--shadow-sm` e `--shadow-md`; l'elevazione comunica gerarchia.

## Layout

- Contenuto dentro `.app-shell`, con `.page-stack` come ritmo verticale principale.
- Hero scuro per identità della pagina, card bianche per blocchi operativi distinti.
- Flex per barre e righe; grid per form e strutture bidimensionali.
- Le tabelle restano dense su desktop e scorrono orizzontalmente quando necessario; su mobile i flussi principali devono ricomporsi e mantenere tutti i comandi.
- Evitare card annidate e valori inline quando una classe condivisa può descrivere il pattern.

## Components

- Pulsanti: `.primary-button` per l'azione principale, `.ghost-button` per quella secondaria, `.danger-button` per azioni distruttive.
- Stato: `.status-badge` con una variante semantica condivisa; aggiungere sempre un'etichetta testuale, non solo colore o icona.
- Form: label sempre visibile, messaggi specifici e azioni con verbo + oggetto.
- Feedback: banner di errore e successo coerenti; loading skeleton per contenuto strutturato; empty state che spiega la prossima azione.
- Selettori: riusare `Select`, `MultiSelect` e `DateInput`; opzioni non selezionabili devono essere semanticamente disabilitate e spiegare il motivo.
- Modali solo per compiti circoscritti o conferme realmente necessarie; preferire sezioni inline per flussi ricorrenti.

## Motion and interaction

- Transizioni di stato tra 120 e 220 ms con easing morbido; niente animazioni decorative che interrompono il lavoro.
- Hover, focus-visible, active, disabled, loading, error, success ed empty sono parte della definizione di ogni componente interattivo.
- `prefers-reduced-motion` deve continuare a disattivare animazioni e transizioni non essenziali.

## Content

- Tutto il testo utente è in italiano.
- Terminologia stabile: gara, designazione, osservatore, indisponibilità, rapporto, arbitro, formatore.
- Errori: cosa è successo, perché, come risolvere.
- Successi: confermare l'oggetto modificato e l'effetto della modifica.

## Responsive and accessibility

- Mobile-first; verificare almeno 320/390 px, tablet e desktop.
- Nessuna funzione essenziale hover-only.
- Focus sempre visibile, markup semantico, nomi accessibili per icon button e annunci testuali per stati importanti.
- Testo ordinario con contrasto minimo 4.5:1 e testo grande almeno 3:1.
