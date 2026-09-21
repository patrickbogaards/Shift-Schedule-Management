'use strict';
/* ===== Gesetzliche Feiertage Österreich ===== */

// Ostersonntag (Gaußsche Osterformel, gregorianisch)
function easterDn(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return dnOf(y, month, day);
}

const _holCache = new Map();
function holidaysAT(y) {
  if (_holCache.has(y)) return _holCache.get(y);
  const E = easterDn(y);
  const list = [
    [dnOf(y, 1, 1), 'Neujahr'],
    [dnOf(y, 1, 6), 'Heilige Drei Könige'],
    [E + 1, 'Ostermontag'],
    [dnOf(y, 5, 1), 'Staatsfeiertag'],
    [E + 39, 'Christi Himmelfahrt'],
    [E + 50, 'Pfingstmontag'],
    [E + 60, 'Fronleichnam'],
    [dnOf(y, 8, 15), 'Mariä Himmelfahrt'],
    [dnOf(y, 10, 26), 'Nationalfeiertag'],
    [dnOf(y, 11, 1), 'Allerheiligen'],
    [dnOf(y, 12, 8), 'Mariä Empfängnis'],
    [dnOf(y, 12, 25), 'Christtag'],
    [dnOf(y, 12, 26), 'Stefanitag'],
  ].map(([dn, name]) => ({ dn, name })).sort((a, b) => a.dn - b.dn);
  const map = new Map(list.map(h => [h.dn, h.name]));
  const res = { list, map };
  _holCache.set(y, res);
  return res;
}
function holidayName(dn) {
  return holidaysAT(ymd(dn).y).map.get(dn) || null;
}
