// Compatibilità con inviti, callback e segnalibri precedenti alla home pubblica.
// Il frammento resta nel browser: non viene inviato al server o a terzi.
if (/^#\//.test(window.location.hash)) {
  window.location.replace(`/app${window.location.search}${window.location.hash}`);
}
