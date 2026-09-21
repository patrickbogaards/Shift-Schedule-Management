'use strict';
/* ===== Datenmodell, Standardwerte, Zugriffshilfen ===== */

const POS_COLORS = ['#e8590c', '#2f9e44', '#1971c2', '#9c36b5', '#f08c00', '#0c8599', '#c2255c', '#5c7cfa', '#868e96'];

// Vorschlagswerte je Anstellungsart (Wochenstunden, Arbeitstage pro Woche)
const EMP_TYPES = {
  'Vollzeit': { weekly: 40, days: 5 },
  'Teilzeit': { weekly: 25, days: 4 },
  'Geringfügig': { weekly: 12, days: 2 },
  'Aushilfe': { weekly: 12, days: 2 },
  'Lehrling': { weekly: 40, days: 5 },
};
const COMPANY_NAME = 'Tiziano Restaurant GmbH';
const ABS_TYPES = { urlaub: 'Urlaub', krank: 'Krankenstand', za: 'Zeitausgleich', frei: 'Frei (fix)' };

let state = null;   // aktueller Datenbestand
let stateVer = 0;   // Änderungszähler (für Zwischenspeicher)
const touch = () => { stateVer++; };

function defaultSettings() {
  const s = {
    name: COMPANY_NAME,
    positions: [
      { id: 'pos_pizza', name: 'Pizzakoch', color: POS_COLORS[0] },
      { id: 'pos_kueche', name: 'Küche / Koch', color: POS_COLORS[1] },
      { id: 'pos_service', name: 'Service', color: POS_COLORS[2] },
      { id: 'pos_abwasch', name: 'Abwasch / Küchenhilfe', color: POS_COLORS[3] },
    ],
    // covers: F = deckt die Früh-Hälfte des Tages ab, S = Spät-Hälfte, FS = beide (durchgehend)
    shifts: [
      { id: 'sh_frueh', name: 'Frühdienst', start: '10:00', end: '17:00', pause: 30, covers: 'F' },
      { id: 'sh_spaet', name: 'Spätdienst', start: '17:00', end: '23:30', pause: 30, covers: 'S' },
      { id: 'sh_durch', name: 'Durchgehend', start: '11:00', end: '21:00', pause: 60, covers: 'FS' },
    ],
    openDays: [false, true, true, true, true, true, true], // Montag = Ruhetag
    req: {},            // Mindestbesetzung: req[positionId][wochentag] = [früh, spät]
    minPersons: 4,      // mindestens so viele Personen pro Öffnungstag
    minRestH: 11,       // Mindestruhezeit zwischen zwei Diensten (Stunden)
    maxConsec: 6,       // maximal so viele Arbeitstage in Folge
    fairWeekends: true,
    closedHolidays: {}, // "JJJJ-MM-TT" -> true: Restaurant an diesem Feiertag geschlossen
    closures: [],       // Betriebsruhe: { id, from, to, note }
  };
  ensureReq(s);
  return s;
}

function ensureReq(s) {
  s.req = s.req || {};
  for (const p of s.positions) {
    let r = s.req[p.id];
    if (!Array.isArray(r) || r.length !== 7) r = s.req[p.id] = [0, 1, 2, 3, 4, 5, 6].map(() => [1, 1]);
    for (let k = 0; k < 7; k++) {
      if (!Array.isArray(r[k])) r[k] = [1, 1];
      r[k][0] = Math.max(0, r[k][0] | 0);
      r[k][1] = Math.max(0, r[k][1] | 0);
    }
  }
}

function defaultState() {
  return { v: 1, settings: defaultSettings(), employees: [], absences: [], plan: {} };
}

// Fehlende Felder ergänzen (ältere Sicherungen, händisch veränderte Dateien)
function migrate(s) {
  if (!s || typeof s !== 'object' || !Array.isArray(s.employees) || !s.settings) throw new Error('Ungültige Datei');
  const d = defaultSettings();
  s.settings = Object.assign({}, d, s.settings);
  if (!s.settings.name || s.settings.name === 'Restaurant') s.settings.name = COMPANY_NAME; // früherer Platzhalter
  if (!Array.isArray(s.settings.positions) || !s.settings.positions.length) s.settings.positions = d.positions;
  if (!Array.isArray(s.settings.shifts) || !s.settings.shifts.length) s.settings.shifts = d.shifts;
  if (!Array.isArray(s.settings.openDays) || s.settings.openDays.length !== 7) s.settings.openDays = d.openDays;
  s.settings.closedHolidays = s.settings.closedHolidays || {};
  s.settings.closures = s.settings.closures || [];
  ensureReq(s.settings);
  s.absences = Array.isArray(s.absences) ? s.absences : [];
  s.plan = s.plan && typeof s.plan === 'object' ? s.plan : {};
  const tpl = newEmployee('Vollzeit');
  s.employees = s.employees.map(e => Object.assign({}, tpl, e, { id: e.id || uid('e') }));
  s.v = 1;
  return s;
}

function newEmployee(type, o) {
  const t = EMP_TYPES[type] || EMP_TYPES['Vollzeit'];
  return Object.assign({
    id: uid('e'), name: '', type: type || 'Vollzeit',
    weekly: t.weekly, days: t.days, vac: 5 * t.days,
    vacRest: null,        // Resturlaub (Tage) per Stichtag; null = noch nicht angegeben (dann gilt der volle Anspruch)
    vacCarry: 0, vacUsedBefore: 0, balStart: 0, trackFrom: fromDn(todayDn()), // trackFrom = erster gezählter Tag = Stichtag + 1
    main: '', alt: [], allowed: null, offDays: [], from: '', to: '', active: true, note: '',
  }, o || {});
}

/* ---------- Zugriff / Zwischenspeicher ---------- */

let _idx = null, _idxVer = -1;
function getIndex() {
  if (_idx && _idxVer === stateVer) return _idx;
  const idx = { emp: new Map(), pos: new Map(), shift: new Map(), abs: new Map(), closures: [], planEmp: new Map() };
  state.employees.forEach(e => idx.emp.set(e.id, e));
  state.settings.positions.forEach(p => idx.pos.set(p.id, p));
  state.settings.shifts.forEach(s => idx.shift.set(s.id, s));
  // Abwesenheiten je Person und Tag (Krank vor Urlaub vor Zeitausgleich)
  const prio = { krank: 4, urlaub: 3, za: 2, frei: 1 };
  for (const a of state.absences) {
    const f = toDn(a.from), t = toDn(a.to);
    if (isNaN(f) || isNaN(t)) continue;
    let m = idx.abs.get(a.emp);
    if (!m) idx.abs.set(a.emp, (m = new Map()));
    for (let d = f; d <= t && d - f < 800; d++) {
      const old = m.get(d);
      if (!old || prio[a.type] > prio[old]) m.set(d, a.type);
    }
  }
  idx.closures = state.settings.closures
    .map(c => ({ a: toDn(c.from), b: toDn(c.to), note: c.note || 'Betriebsruhe' }))
    .filter(c => !isNaN(c.a) && !isNaN(c.b));
  for (const iso in state.plan) {
    const dn = toDn(iso);
    for (const en of state.plan[iso]) {
      const key = en.emp + '|' + dn;
      const arr = idx.planEmp.get(key);
      if (arr) arr.push(en); else idx.planEmp.set(key, [en]);
    }
  }
  _idx = idx; _idxVer = stateVer;
  return idx;
}
const getEmp = id => getIndex().emp.get(id);
const getPos = id => getIndex().pos.get(id);
const getShift = id => getIndex().shift.get(id);
const entriesOf = (empId, dn) => getIndex().planEmp.get(empId + '|' + dn) || EMPTY;
const entHours = en => netHours(en.start, en.end, en.pause);
const dayEntries = dn => state.plan[fromDn(dn)] || EMPTY;
const absenceOf = (empId, dn) => { const m = getIndex().abs.get(empId); return m ? m.get(dn) || null : null; };

// Öffnungsstatus eines Tages
function dayStatus(dn) {
  const S = state.settings, wd = wdOf(dn);
  const holiday = holidayName(dn);
  const ruhetag = !S.openDays[wd];
  let closure = null;
  for (const c of getIndex().closures) if (dn >= c.a && dn <= c.b) { closure = c.note; break; }
  const closedHoliday = !!(holiday && S.closedHolidays[fromDn(dn)]);
  const open = !ruhetag && !closure && !closedHoliday;
  let closedReason = null;
  if (!open) closedReason = ruhetag ? 'Ruhetag' : closure ? closure : holiday + ' (geschlossen)';
  return { wd, holiday, ruhetag, closure, closedHoliday, open, closedReason };
}

/* ---------- Dienste (Einträge im Plan) ---------- */

const covMask = c => (String(c || '').indexOf('F') >= 0 ? 1 : 0) | (String(c || '').indexOf('S') >= 0 ? 2 : 0);
const covStr = m => (m & 1 ? 'F' : '') + (m & 2 ? 'S' : '');
// Wird ein eigener Dienst eingetragen, ergibt sich die Abdeckung aus der Uhrzeit (Tagesmitte 17:00)
function autoCov(start, end) {
  const { s, e } = shiftSpan(start, end);
  return covStr((s < 17 * 60 ? 1 : 0) | (e > 17 * 60 ? 2 : 0));
}
function makeEntry(empId, posId, sh, manual) {
  return {
    id: uid('n'), emp: empId, pos: posId, shift: sh.id || 'custom',
    start: sh.start, end: sh.end, pause: +sh.pause || 0,
    cov: sh.covers || autoCov(sh.start, sh.end), manual: !!manual,
  };
}
function addEntry(dn, entry) {
  const iso = fromDn(dn);
  (state.plan[iso] = state.plan[iso] || []).push(entry);
  touch();
}
function removeEntriesOf(empId, fromD, toD) {
  let n = 0;
  for (let d = fromD; d <= toD; d++) {
    const iso = fromDn(d), arr = state.plan[iso];
    if (!arr) continue;
    const keep = arr.filter(en => en.emp !== empId);
    n += arr.length - keep.length;
    if (keep.length) state.plan[iso] = keep; else delete state.plan[iso];
  }
  if (n) touch();
  return n;
}

// Alle Dienste und Abwesenheiten einer Person nach einem Stichtag entfernen (z. B. nach dem Austritt)
function removeAfter(empId, dn) {
  let n = 0;
  for (const iso in state.plan) {
    if (toDn(iso) <= dn) continue;
    const keep = state.plan[iso].filter(en => en.emp !== empId);
    n += state.plan[iso].length - keep.length;
    if (keep.length) state.plan[iso] = keep; else delete state.plan[iso];
  }
  state.absences = state.absences.flatMap(a => {
    if (a.emp !== empId || toDn(a.to) <= dn) return [a];
    if (toDn(a.from) > dn) return [];
    return [Object.assign({}, a, { to: fromDn(dn) })];
  });
  touch();
  return n;
}

/* ---------- Abwesenheiten ---------- */

// Benachbarte Abwesenheiten gleicher Art einer Person zusammenfassen
function mergeAbsences(empId) {
  const mine = state.absences.filter(a => a.emp === empId).sort((a, b) => toDn(a.from) - toDn(b.from));
  const merged = [];
  for (const a of mine) {
    const last = merged[merged.length - 1];
    if (last && last.type === a.type && (last.note || '') === (a.note || '') && toDn(a.from) <= toDn(last.to) + 1) {
      if (toDn(a.to) > toDn(last.to)) last.to = a.to;
    } else merged.push(Object.assign({}, a));
  }
  state.absences = state.absences.filter(a => a.emp !== empId).concat(merged);
  touch();
}
// Für einen einzelnen Tag die Abwesenheit setzen (type = null: Tag frei von Abwesenheit)
function setAbsenceDay(empId, dn, type) {
  const out = [];
  for (const a of state.absences) {
    const f = toDn(a.from), t = toDn(a.to);
    if (a.emp !== empId || dn < f || dn > t) { out.push(a); continue; }
    if (f < dn) out.push(Object.assign({}, a, { id: uid('a'), to: fromDn(dn - 1) }));
    if (t > dn) out.push(Object.assign({}, a, { id: uid('a'), from: fromDn(dn + 1) }));
  }
  state.absences = out;
  if (type) state.absences.push({ id: uid('a'), emp: empId, from: fromDn(dn), to: fromDn(dn), type, note: '' });
  mergeAbsences(empId);
}

/* ---------- Mitarbeiter entfernen ---------- */

// Personen samt Diensten und Abwesenheiten endgültig entfernen
function deleteEmployees(ids) {
  const set = new Set(ids);
  state.employees = state.employees.filter(e => !set.has(e.id));
  state.absences = state.absences.filter(a => !set.has(a.emp));
  for (const iso in state.plan) {
    const keep = state.plan[iso].filter(en => !set.has(en.emp));
    if (keep.length) state.plan[iso] = keep; else delete state.plan[iso];
  }
  touch();
}

// Frühere Programmversionen enthielten Muster-Mitarbeiter (Beispieldaten). Diese Namen dienen nur dazu,
// solche Reste in bereits gespeicherten Daten zu erkennen und auf Wunsch zu entfernen.
const LEGACY_SAMPLE_NAMES = ['Marco Rossi', 'Luca Bianchi', 'Giulia Ferrari', 'Stefan Huber', 'Anna Gruber',
  'Sabine Wagner', 'Elena Novak', 'Tobias Berger', 'Mehmet Yilmaz', 'Lisa Steiner'];
function legacySampleEmployees() {
  const found = state.employees.filter(e => LEGACY_SAMPLE_NAMES.indexOf(e.name) >= 0);
  return found.length >= 5 ? found : []; // erst ab 5 Treffern, damit einzelne echte Mitarbeiter mit gleichem Namen nicht betroffen sind
}
