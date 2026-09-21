'use strict';
/* ===== Start ===== */

(function init() {
  loadMeta();
  state = loadFromStorage() || defaultState();
  touch();
  let storageOk = true;
  try { localStorage.setItem('dienstplan.test', '1'); localStorage.removeItem('dienstplan.test'); } catch (e) { storageOk = false; }
  render();
  if (!storageOk) toast('Der Browser erlaubt kein Speichern (privates Fenster?). Bitte ein normales Fenster verwenden oder regelmäßig eine Sicherung herunterladen.', 'bad');
  fsInit();
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* egal */ }
})();

// Muster-Mitarbeiter aus früheren Versionen (Beispieldaten) auf Wunsch entfernen
function offerSampleCleanup() {
  if (meta.sampleIgnored || $('#modal-root').firstChild) return;
  const list = legacySampleEmployees();
  if (!list.length) return;
  openModal({
    title: 'Muster-Mitarbeiter entfernen', noFocus: true, danger: true, submitLabel: 'Muster-Mitarbeiter entfernen',
    body: '<p class="confirm-text">In den gespeicherten Daten befinden sich noch Muster-Mitarbeiter aus den früheren Beispieldaten:</p>' +
      '<p><b>' + list.map(e => esc(e.name)).join(', ') + '</b></p>' +
      '<p class="muted">Sie werden samt ihren Diensten und Urlauben vollständig entfernt. Alle anderen Mitarbeiter bleiben unverändert.</p>',
    extraHtml: '<button type="button" class="btn ghost" data-act="sample-ignore">Nicht mehr fragen</button>',
    onSubmit: () => { mutate(() => deleteEmployees(list.map(e => e.id))); toast(list.length + ' Muster-Mitarbeiter entfernt'); },
  });
}
ACTIONS['sample-ignore'] = () => { meta.sampleIgnored = true; saveMeta(); closeModal(); };
setTimeout(offerSampleCleanup, 250);

window.addEventListener('error', ev => { console.error(ev.error || ev.message); });
