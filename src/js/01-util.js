'use strict';
/* ===== Hilfsfunktionen: Datum, Zeit, Formatierung ===== */

const WD_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const WD_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const MONTHS = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const DAY_MS = 86400000;
const EMPTY = Object.freeze([]);

const p2 = n => (n < 10 ? '0' : '') + n;

// Tage werden intern als fortlaufende Tagesnummer (dn) geführt, gespeichert als "JJJJ-MM-TT".
function dnOf(y, m, d) { return Math.round(Date.UTC(y, m - 1, d) / DAY_MS); }
const isoCache = new Map();
function fromDn(dn) {
  let s = isoCache.get(dn);
  if (!s) {
    const t = new Date(dn * DAY_MS);
    s = t.getUTCFullYear() + '-' + p2(t.getUTCMonth() + 1) + '-' + p2(t.getUTCDate());
    isoCache.set(dn, s);
  }
  return s;
}
function toDn(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? dnOf(+m[1], +m[2], +m[3]) : NaN;
}
function ymd(dn) {
  const t = new Date(dn * DAY_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
const wdOf = dn => (((dn + 3) % 7) + 7) % 7; // Montag = 0
const mondayOf = dn => dn - wdOf(dn);
function todayDn() {
  const n = new Date();
  return dnOf(n.getFullYear(), n.getMonth() + 1, n.getDate());
}
const monthStart = (y, m) => dnOf(y, m, 1);
const monthEnd = (y, m) => dnOf(y, m + 1, 1) - 1;
function isoWeek(dn) {
  const thu = dn - wdOf(dn) + 3;
  const y = ymd(thu).y;
  return { week: Math.floor((thu - dnOf(y, 1, 1)) / 7) + 1, year: y };
}

// Formatierung (deutsch)
function fmtDate(dn) { const t = ymd(dn); return p2(t.d) + '.' + p2(t.m) + '.' + t.y; }
function fmtDM(dn) { const t = ymd(dn); return p2(t.d) + '.' + p2(t.m) + '.'; }
function fmtNum(x, dec) {
  dec = dec === undefined ? 2 : dec;
  const f = Math.pow(10, dec);
  return (Math.round((+x || 0) * f) / f).toFixed(dec).replace('.', ',');
}
const fmtH = x => fmtNum(x, 2);
function fmtSigned(x) {
  const v = Math.round((+x || 0) * 100) / 100;
  return (v > 0 ? '+' : v < 0 ? '-' : '') + fmtNum(Math.abs(v), 2);
}
function fmtDaysExact(x) { // Urlaubstage genau (bis 2 Nachkommastellen, ohne überflüssige Nullen)
  return String(Math.round((+x || 0) * 100) / 100).replace('.', ',');
}
function fmtDays(x) {
  const v = Math.round((+x || 0) * 10) / 10;
  return String(v).replace('.', ',');
}

// Uhrzeiten als "HH:MM" <-> Minuten seit Mitternacht
function parseHM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s || '');
  return m ? +m[1] * 60 + +m[2] : NaN;
}
function fmtHM(min) {
  min = ((Math.round(min) % 1440) + 1440) % 1440;
  return p2(Math.floor(min / 60)) + ':' + p2(min % 60);
}
// Dienst von/bis; endet er "vor" dem Beginn, geht er über Mitternacht
function shiftSpan(start, end) {
  const s = parseHM(start);
  let e = parseHM(end);
  if (e <= s) e += 1440;
  return { s, e };
}
function netHours(start, end, pause) {
  const { s, e } = shiftSpan(start, end);
  return Math.max(0, (e - s - (+pause || 0)) / 60);
}

// Sonstiges
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function uid(prefix) {
  return (prefix || 'x') + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
}
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const clone = o => JSON.parse(JSON.stringify(o));
function tint(hex, a) {
  const n = parseInt(String(hex).replace('#', ''), 16) || 0;
  return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
