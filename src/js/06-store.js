'use strict';
/* ===== Speichern, Rückgängig, Sicherung =====
 * Arbeitskopie: localStorage des Browsers (schneller Start, geht in jedem Browser).
 * Zusätzlich (Chrome/Edge): ein Datenordner auf dem Computer. Dort liegt die Datei "Dienstplan-Daten.json" und im
 * Unterordner "Sicherungen" je Arbeitstag eine Kopie (die letzten 30). Der Ordner ist die maßgebliche Fassung:
 * beim Start werden neuere Daten aus dem Ordner übernommen. Jeder Stand trägt einen Zeitstempel (savedAt).
 * Abweichungen werden erkannt und nie stillschweigend überschrieben; die jeweils ersetzte Fassung wird aufgehoben.
 */

const STORE_KEY = 'dienstplan.daten.v1';
const META_KEY = 'dienstplan.meta.v1';
const DATA_FILE = 'Dienstplan-Daten.json';
const BACKUP_DIR = 'Sicherungen';
const KEEP_BACKUPS = 30;
let meta = { lastBackup: 0, fsLastWritten: 0 };
const undoStack = [];
let saveTimer = null;
let saveState = 'saved'; // saved | saving | error
const fsApi = {
  supported: typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function',
  dir: null, name: '', ok: false, error: '', conflict: null,
  lastSavedAt: 0, lastBackupDay: '', busy: false, again: false,
};

function loadMeta() {
  try { meta = Object.assign(meta, JSON.parse(localStorage.getItem(META_KEY) || '{}')); } catch (e) { /* egal */ }
}
function saveMeta() {
  try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) { /* egal */ }
}
function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return migrate(JSON.parse(raw));
  } catch (e) { console.warn('Laden fehlgeschlagen', e); }
  return null;
}

function pushUndo() {
  undoStack.push(JSON.stringify(state));
  if (undoStack.length > 25) undoStack.shift();
}
// Änderung am Datenbestand: Rückgängig-Punkt setzen, ausführen, speichern, neu zeichnen
function mutate(fn) {
  pushUndo();
  const r = fn();
  afterChange();
  return r;
}
function afterChange() {
  touch();
  scheduleSave();
  render();
}
function undo() {
  const snap = undoStack.pop();
  if (!snap) { toast('Nichts zum Rückgängigmachen'); return; }
  state = migrate(JSON.parse(snap));
  afterChange();
  toast('Rückgängig gemacht');
}

/* ---------- Speichern (Browser und Datenordner) ---------- */

function scheduleSave() {
  saveState = 'saving';
  updateFooter();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 350);
}
function saveLocalRaw() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    saveState = 'saved';
  } catch (e) {
    saveState = 'error';
    console.error(e);
  }
  updateFooter();
}
function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  state.savedAt = Math.max(Date.now(), (state.savedAt || 0) + 1, (fsApi.lastSavedAt || 0) + 1);
  saveLocalRaw();
  fsWrite();
}
window.addEventListener('beforeunload', () => { if (saveTimer) saveNow(); });

/* ---------- Sicherung als Datei (geht in jedem Browser) ---------- */

function downloadBackup() {
  const blob = new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'Dienstplan-Sicherung-' + fromDn(todayDn()) + '.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  meta.lastBackup = Date.now();
  saveMeta();
  updateFooter();
  toast('Sicherung heruntergeladen. Bitte an einem sicheren Ort aufbewahren.');
}
function restoreFromText(text) {
  let s;
  try { s = migrate(JSON.parse(text)); } catch (e) { toast('Diese Datei ist keine gültige Dienstplan-Sicherung.', 'bad'); return; }
  confirmBox('Alle aktuellen Daten werden durch die Sicherung ersetzt (' + s.employees.length + ' Mitarbeiter). Fortfahren?', 'Sicherung laden', () => {
    fsSafetyCopy('vor-Sicherung-laden');
    pushUndo();
    state = s;
    afterChange();
    toast('Sicherung geladen');
  }, true);
}

/* ---------- Datenordner (Chrome / Edge) ---------- */

function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('dienstplan-fs', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet(k) {
  const db = await idbOpen();
  return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
}
async function idbSet(k, v) {
  const db = await idbOpen();
  return new Promise((res, rej) => { const q = db.transaction('kv', 'readwrite').objectStore('kv').put(v, k); q.onsuccess = () => res(); q.onerror = () => rej(q.error); });
}

const dayStamp = t => { const d = new Date(t); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); };
const timeStamp = t => { const d = new Date(t); return dayStamp(t) + '-' + p2(d.getHours()) + p2(d.getMinutes()); };
const fmtStand = t => (t ? new Date(t).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' }) : 'unbekannt');
const summaryOf = s => s.employees.length + ' Mitarbeiter, ' + Object.keys(s.plan).reduce((n, k) => n + s.plan[k].length, 0) + ' Dienste';

async function fsGetText(dir, name) { // null, wenn die Datei nicht existiert
  try { return await (await (await dir.getFileHandle(name)).getFile()).text(); }
  catch (e) { if (e && e.name === 'NotFoundError') return null; throw e; }
}
async function fsPutText(dir, name, text) { // schreibt über eine Zwischendatei, ein Abbruch beschädigt nichts
  const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
  await w.write(text);
  await w.close();
}
// Stand aus dem Ordner: null = noch keine Datei; wirft bei beschädigter Datei
async function fsReadState() {
  const text = await fsGetText(fsApi.dir, DATA_FILE);
  if (text == null || !text.trim()) return null;
  return migrate(JSON.parse(text));
}
// Kopie im Unterordner "Sicherungen" ablegen, vorhandene Dateien werden nie überschrieben
async function fsKeepCopy(name, text) {
  const bd = await fsApi.dir.getDirectoryHandle(BACKUP_DIR, { create: true });
  if ((await fsGetText(bd, name)) != null) return;
  await fsPutText(bd, name, text);
}
// Aktuellen Stand vor dem Ersetzen im Ordner aufheben
function fsSafetyCopy(label) {
  if (!fsApi.dir || !fsApi.ok) return Promise.resolve();
  const text = JSON.stringify(state, null, 1);
  return fsKeepCopy('Dienstplan-' + label + '-' + timeStamp(Date.now()) + '.json', text).catch(() => { /* nicht kritisch */ });
}
async function fsPruneBackups() {
  try {
    const bd = await fsApi.dir.getDirectoryHandle(BACKUP_DIR, { create: true }), names = [];
    for await (const e of bd.values()) if (e.kind === 'file' && /^Dienstplan-Sicherung-\d{4}-\d{2}-\d{2}\.json$/.test(e.name)) names.push(e.name);
    names.sort();
    for (const n of names.slice(0, Math.max(0, names.length - KEEP_BACKUPS))) await bd.removeEntry(n);
  } catch (e) { /* Aufräumen ist nicht kritisch */ }
}
// Beim ersten Schreiben eines Tages den letzten Stand des früheren Arbeitstages als Tagessicherung aufheben
async function fsDailyBackup() {
  const today = dayStamp(Date.now());
  if (fsApi.lastBackupDay === today) return;
  const text = await fsGetText(fsApi.dir, DATA_FILE);
  if (text) {
    let at = 0;
    try { at = JSON.parse(text).savedAt || 0; } catch (e) { at = 0; }
    if (at && dayStamp(at) < today) await fsKeepCopy('Dienstplan-Sicherung-' + dayStamp(at) + '.json', text);
  }
  await fsPruneBackups();
  fsApi.lastBackupDay = today;
}

async function fsWrite() {
  if (!fsApi.dir || !fsApi.ok || fsApi.conflict) return;
  if (fsApi.busy) { fsApi.again = true; return; } // läuft schon: danach noch einmal mit dem neuesten Stand
  fsApi.busy = true;
  try {
    let cur = null;
    try { cur = await fsReadState(); } catch (e) { throw new Error('Die Datei im Datenordner ist beschädigt und wurde nicht überschrieben.'); }
    // hat jemand anderes (anderer Computer / Browser) die Datei inzwischen geändert?
    if (cur && (cur.savedAt || 0) > fsApi.lastSavedAt) { fsApi.conflict = { file: cur }; fsConflictPrompt(); return; }
    await fsDailyBackup();
    const at = state.savedAt;
    await fsPutText(fsApi.dir, DATA_FILE, JSON.stringify(state, null, 1));
    fsApi.lastSavedAt = at;
    meta.fsLastWritten = at;
    meta.lastBackup = Date.now();
    saveMeta();
    fsApi.error = '';
  } catch (e) {
    console.error(e);
    fsApi.ok = false;
    fsApi.error = e.message || String(e);
    toast('Im Datenordner konnte nicht gespeichert werden: ' + fsApi.error, 'bad');
  } finally {
    fsApi.busy = false;
  }
  updateFooter();
  if (fsApi.again && fsApi.ok && !fsApi.conflict) { fsApi.again = false; fsWrite(); }
}

// Stand des Ordners übernehmen (ohne Rückfrage; nur aufrufen, wenn das eindeutig richtig ist)
function fsAdoptSilently(file, msg) {
  pushUndo();
  state = file;
  fsApi.lastSavedAt = file.savedAt || 0;
  meta.fsLastWritten = fsApi.lastSavedAt;
  saveMeta();
  touch();
  saveLocalRaw();
  render();
  if (msg) toast(msg);
}
// Abgleich beim Start / nach dem Wiederverbinden / auf Wunsch
async function fsSync(manual) {
  let file;
  try { file = await fsReadState(); }
  catch (e) { fsApi.ok = false; fsApi.error = 'Die Datei im Datenordner ist beschädigt.'; toast(fsApi.error + ' Es wurde nichts überschrieben. Die Tagessicherungen liegen im Unterordner „' + BACKUP_DIR + '“.', 'bad'); updateFooter(); return; }
  if (!file) { saveNow(); return; } // Ordner ohne Datei: aktuellen Stand hineinschreiben
  const fAt = file.savedAt || 0, lAt = state.savedAt || 0;
  if (fAt === lAt) { fsApi.lastSavedAt = fAt; if (manual) toast('Bereits auf dem neuesten Stand.'); updateFooter(); return; }
  if (fAt > lAt) { fsAdoptSilently(file, 'Neuere Daten aus dem Datenordner geladen (Stand ' + fmtStand(fAt) + ').'); return; }
  if (fAt === (meta.fsLastWritten || 0)) { fsApi.lastSavedAt = fAt; await fsWrite(); return; } // nur eigene, noch nicht geschriebene Änderungen
  fsApi.conflict = { file };
  fsConflictPrompt();
}
async function fsInit() {
  if (!fsApi.supported) return;
  try {
    const dir = await idbGet('dir');
    if (!dir) return;
    fsApi.dir = dir; fsApi.name = dir.name; fsApi.lastSavedAt = meta.fsLastWritten || 0;
    const perm = typeof dir.queryPermission === 'function' ? await dir.queryPermission({ mode: 'readwrite' }) : 'granted';
    if (perm === 'granted') { fsApi.ok = true; updateFooter(); await fsSync(false); } else updateFooter();
  } catch (e) { console.warn('Datenordner nicht nutzbar', e); }
}
async function fsReconnect() {
  try {
    const perm = typeof fsApi.dir.requestPermission === 'function' ? await fsApi.dir.requestPermission({ mode: 'readwrite' }) : 'granted';
    if (perm !== 'granted') { toast('Ohne Erlaubnis kann nicht im Datenordner gespeichert werden.', 'bad'); return; }
    fsApi.ok = true; fsApi.error = '';
    await fsSync(false);
    render();
    if (fsApi.ok && !fsApi.conflict) toast('Datenordner wieder verbunden');
  } catch (e) { toast('Verbinden nicht möglich: ' + e.message, 'bad'); }
}
async function fsConnect() {
  let dir;
  try { dir = await window.showDirectoryPicker({ id: 'dienstplan-daten', mode: 'readwrite', startIn: 'documents' }); }
  catch (e) { if (!e || e.name !== 'AbortError') toast('Der Ordner konnte nicht geöffnet werden: ' + (e && e.message), 'bad'); return; }
  await fsAttach(dir);
}
// Ordner verbinden (Auswahl durch den Benutzer); bereits vorhandene Daten auf beiden Seiten werden nie stillschweigend ersetzt
async function fsAttach(dir) {
  fsApi.dir = dir; fsApi.name = dir.name; fsApi.ok = true; fsApi.error = ''; fsApi.conflict = null;
  fsApi.lastSavedAt = 0; fsApi.lastBackupDay = ''; meta.fsLastWritten = 0; saveMeta();
  try { await idbSet('dir', dir); } catch (e) { /* Verbindung gilt dann nur bis zum Schließen */ }
  let file;
  try { file = await fsReadState(); }
  catch (e) { fsApi.dir = null; fsApi.ok = false; toast('In diesem Ordner liegt eine beschädigte oder fremde Datei „' + DATA_FILE + '“. Bitte einen anderen Ordner wählen.', 'bad'); render(); return; }
  const localHas = state.employees.length > 0 || Object.keys(state.plan).length > 0;
  if (!file) { saveNow(); render(); toast('Datenordner „' + dir.name + '“ verbunden. Die bisherigen Daten wurden hineingeschrieben.'); return; }
  if (!localHas || (file.savedAt || 0) === (state.savedAt || 0)) { fsAdoptSilently(file, 'Datenordner „' + dir.name + '“ verbunden. Daten geladen (Stand ' + fmtStand(file.savedAt) + ').'); return; }
  fsApi.conflict = { file };
  render();
  fsConflictPrompt();
}
async function fsDisconnect() {
  fsApi.dir = null; fsApi.ok = false; fsApi.name = ''; fsApi.conflict = null; fsApi.error = '';
  meta.fsLastWritten = 0; saveMeta();
  try { await idbSet('dir', null); } catch (e) { /* egal */ }
  render();
}

/* ---------- Abweichende Daten im Ordner ---------- */

function fsConflictPrompt() {
  const c = fsApi.conflict;
  if (!c) return;
  const f = c.file, folderNewer = (f.savedAt || 0) > (state.savedAt || 0);
  updateFooter();
  const adopt = { label: 'Daten aus dem Ordner laden', act: 'fs-adopt' };
  const over = { label: 'Meine Daten in den Ordner schreiben', act: 'fs-overwrite' };
  const main = folderNewer ? adopt : over, other = folderNewer ? over : adopt;
  openModal({
    title: 'Datenordner: abweichende Daten', submitLabel: main.label, noFocus: true,
    body: '<p class="confirm-text">Die Daten im Datenordner sind nicht dieselben wie in diesem Browser. Das passiert, wenn zwischendurch auf einem anderen Computer oder in einem anderen Browser gearbeitet wurde.</p>' +
      '<table class="list cfg"><thead><tr><th></th><th>Stand</th><th>Inhalt</th></tr></thead><tbody>' +
      '<tr><td><b>Datenordner „' + esc(fsApi.name) + '“</b></td><td>' + fmtStand(f.savedAt) + '</td><td>' + esc(summaryOf(f)) + '</td></tr>' +
      '<tr><td><b>Dieser Browser</b></td><td>' + fmtStand(state.savedAt) + '</td><td>' + esc(summaryOf(state)) + '</td></tr></tbody></table>' +
      '<p class="muted">Die jeweils ersetzte Fassung wird im Unterordner „' + BACKUP_DIR + '“ aufgehoben, es geht nichts verloren. Solange nichts entschieden ist, wird im Datenordner nichts geändert.</p>',
    extraHtml: '<button type="button" class="btn" data-act="' + other.act + '">' + other.label + '</button>',
    onSubmit: () => { ACTIONS[main.act](); },
  });
}
async function fsAdoptFolder() {
  const c = fsApi.conflict;
  if (!c) return;
  await fsSafetyCopy('Browserstand');
  fsApi.conflict = null;
  fsAdoptSilently(c.file, 'Daten aus dem Datenordner geladen (Stand ' + fmtStand(c.file.savedAt) + ').');
}
async function fsOverwriteFolder() {
  const c = fsApi.conflict;
  if (!c) return;
  try {
    const old = await fsGetText(fsApi.dir, DATA_FILE);
    if (old) await fsKeepCopy('Dienstplan-Ordnerstand-' + timeStamp(Date.now()) + '.json', old);
  } catch (e) { /* nicht kritisch */ }
  fsApi.lastSavedAt = c.file.savedAt || 0;
  fsApi.conflict = null;
  saveNow();
  toast('Deine Daten wurden in den Datenordner geschrieben.');
}

// Text für die Fußzeile
function backupStatus() {
  if (fsApi.dir) {
    if (fsApi.conflict) return { level: 'warn', text: 'Der Datenordner enthält abweichende Daten', action: 'fs-resolve', label: 'Klären' };
    if (!fsApi.ok) return { level: 'warn', text: 'Datenordner „' + fsApi.name + '“ ist nicht verbunden. Änderungen werden vorerst nur im Browser gespeichert.', action: 'fs-reconnect', label: 'Wieder verbinden' };
    return { level: 'ok', text: 'Gespeichert im Datenordner „' + fsApi.name + '“ (mit täglichen Sicherungen)' };
  }
  if (fsApi.supported) return { level: 'warn', text: 'Noch kein Datenordner gewählt. Die Daten liegen nur in diesem Browser.', action: 'fs-connect', label: 'Datenordner wählen' };
  if (!meta.lastBackup) return { level: 'warn', text: 'Noch keine Sicherung. Die Daten liegen nur in diesem Browser.', action: 'backup', label: 'Jetzt sichern' };
  const days = Math.floor((Date.now() - meta.lastBackup) / DAY_MS);
  if (days >= 14) return { level: 'warn', text: 'Letzte Sicherung vor ' + days + ' Tagen', action: 'backup', label: 'Jetzt sichern' };
  return { level: 'ok', text: 'Letzte Sicherung: ' + new Date(meta.lastBackup).toLocaleDateString('de-AT') };
}
