'use strict';
/* ===== Oberfläche: gemeinsame Bausteine ===== */

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

const ACTIONS = {}; // data-act  -> Funktion(element, event)
const CHANGE = {};  // data-chg  -> Funktion(element, event)

const ui = {
  tab: 'plan',
  ws: mondayOf(todayDn()),
  month: { y: ymd(todayDn()).y, m: ymd(todayDn()).m },
  absYear: ymd(todayDn()).y,
  absEmp: '',
  holYear: ymd(todayDn()).y,
};

const opt = (val, label, sel) => '<option value="' + esc(val) + '"' + (sel ? ' selected' : '') + '>' + esc(label) + '</option>';
const posDot = id => { const p = getPos(id); return p ? '<i class="pdot" style="background:' + p.color + '"></i>' : ''; };
const saldoClass = x => (x > 0.004 ? 'plus' : x < -0.004 ? 'minus' : 'zero');

/* ---------- Hinweise, Rückfragen, Fenster ---------- */

let toastTimer;
function toast(msg, kind) {
  const el = $('#toast');
  el.className = 'toast show ' + (kind || '');
  el.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), kind === 'bad' ? 7000 : 3500);
}

function openModal(o) {
  const root = $('#modal-root');
  root.innerHTML =
    '<div class="modal-back" data-act="modal-backdrop"><div class="modal' + (o.wide ? ' wide' : '') + '" role="dialog" aria-modal="true" aria-label="' + esc(o.title) + '">' +
    '<form class="modal-form" autocomplete="off" novalidate>' +
    '<div class="modal-head"><h3>' + esc(o.title) + '</h3><button type="button" class="icon-btn" data-act="modal-close" aria-label="Schließen">✕</button></div>' +
    '<div class="modal-body">' + o.body + '</div>' +
    '<div class="modal-foot">' + (o.extraHtml || '') + '<span class="sp"></span>' +
    '<button type="button" class="btn" data-act="modal-close">' + (o.onSubmit ? 'Abbrechen' : 'Schließen') + '</button>' +
    (o.onSubmit ? '<button type="submit" class="btn ' + (o.danger ? 'danger' : 'primary') + '">' + esc(o.submitLabel || 'Speichern') + '</button>' : '') +
    '</div></form></div></div>';
  const form = $('.modal-form', root);
  form.addEventListener('submit', ev => {
    ev.preventDefault();
    if (o.onSubmit && o.onSubmit(form) === false) return;
    closeModal();
  });
  if (o.onMount) o.onMount(form);
  if (!o.noFocus) {
    const first = $('input:not([type=hidden]):not([type=radio]):not([type=checkbox]):not([type=color]), select', form);
    if (first) first.focus();
  }
}
function closeModal() { $('#modal-root').innerHTML = ''; }
function confirmBox(msg, okLabel, onOk, danger) {
  openModal({ title: 'Bitte bestätigen', body: '<p class="confirm-text">' + esc(msg) + '</p>', submitLabel: okLabel || 'OK', danger, noFocus: true, onSubmit: () => { onOk(); } });
}
function showBusy(msg) { const b = $('#busy'); b.hidden = false; $('.busy-msg', b).textContent = msg; }
function hideBusy() { $('#busy').hidden = true; }
const nextTick = () => new Promise(r => setTimeout(r, 15));

/* ---------- Kopfzeile / Fußzeile ---------- */

function renderTop() {
  const tabs = [['plan', 'Dienstplan'], ['emp', 'Mitarbeiter'], ['abs', 'Abwesenheiten'], ['report', 'Auswertung'], ['set', 'Einstellungen']];
  $('#top').innerHTML =
    '<div class="brand"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 9h18M8 2v4M16 2v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M7 13h4M7 17h7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
    '<span>' + esc(state.settings.name) + '</span><small>Dienstplan</small></div>' +
    '<nav>' + tabs.map(t => '<button class="tab' + (ui.tab === t[0] ? ' on' : '') + '" data-act="tab" data-tab="' + t[0] + '">' + t[1] + '</button>').join('') + '</nav>' +
    '<div class="top-tools"><button class="btn ghost light" data-act="undo" title="Letzte Änderung rückgängig machen"' + (undoStack.length ? '' : ' disabled') + '>↶ Rückgängig</button></div>';
}
function updateFooter() {
  const el = $('#foot');
  if (!el) return;
  const b = backupStatus();
  const s = saveState === 'saving' ? 'Speichert …' : saveState === 'error' ? 'Speichern im Browser fehlgeschlagen!' : 'Alle Änderungen gespeichert';
  el.innerHTML = '<span class="dot ' + (saveState === 'error' ? 'bad' : 'ok') + '"></span>' + s +
    '<span class="sepdot">·</span><span class="dot ' + b.level + '"></span>' + esc(b.text) +
    (b.action ? ' <button class="link" data-act="' + b.action + '">' + b.label + '</button>' : '');
}

/* ---------- Zeichnen ---------- */

const VIEWS = {}; // tab -> Funktion, die HTML liefert
function render() {
  const active = document.activeElement;
  const key = active && active.dataset ? active.dataset.key : null;
  let caret = null;
  if (key && typeof active.selectionStart === 'number') { try { caret = [active.selectionStart, active.selectionEnd]; } catch (e) { caret = null; } }
  renderTop();
  $('#main').innerHTML = VIEWS[ui.tab]();
  document.body.dataset.tab = ui.tab;
  document.title = state.settings.name + ' – Dienstplan';
  updateFooter();
  if (key) {
    const el = $('[data-key="' + key + '"]');
    if (el) { el.focus(); if (caret && typeof el.setSelectionRange === 'function') { try { el.setSelectionRange(caret[0], caret[1]); } catch (e) { /* egal */ } } }
  }
}

/* ---------- Ereignisse ---------- */

document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'modal-backdrop') { if (ev.target === el) closeModal(); return; }
  const fn = ACTIONS[act];
  if (fn) { if (el.tagName !== 'INPUT') ev.preventDefault(); fn(el, ev); }
});
document.addEventListener('change', ev => {
  const el = ev.target.closest('[data-chg]');
  if (!el) return;
  const fn = CHANGE[el.dataset.chg];
  if (fn) fn(el, ev);
});
document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape' && $('#modal-root').firstChild) closeModal();
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'z' && !/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '') && !$('#modal-root').firstChild) {
    ev.preventDefault(); undo();
  }
});

ACTIONS['modal-close'] = () => closeModal();
ACTIONS.tab = el => { ui.tab = el.dataset.tab; render(); window.scrollTo(0, 0); };
ACTIONS.undo = () => undo();
ACTIONS.print = () => window.print();
ACTIONS.backup = () => downloadBackup();
ACTIONS['fs-reconnect'] = () => fsReconnect();
