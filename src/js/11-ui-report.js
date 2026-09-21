'use strict';
/* ===== Oberfläche: Monatsauswertung =====
 * Je Mitarbeiter ein Blatt mit Beginn und Ende jedes Tages, am Ende eine Zusammenfassung
 * mit Plus-/Minusstunden und Resturlaub. Gedruckt bzw. als PDF gespeichert wird im Querformat.
 */

function reportEmployees(y, m) {
  const a = monthStart(y, m), b = monthEnd(y, m);
  const order = new Map(state.settings.positions.map((p, i) => [p.id, i]));
  return state.employees.filter(e => {
    const s = monthStats(e, y, m);
    if (!s.active) return false;
    if (e.active !== false) return true;
    return s.t.work > 0 || s.t.credit > 0;
  }).sort((p, q) => (order.has(p.main) ? order.get(p.main) : 99) - (order.has(q.main) ? order.get(q.main) : 99) || p.name.localeCompare(q.name, 'de'));
}

const fmtPause = min => (min ? Math.floor(min / 60) + ':' + p2(min % 60) : '');

function sheetHtml(e, y, m, s) {
  let rows = '';
  for (const r of s.recs) {
    const wd = wdOf(r.dn), holiday = holidayName(r.dn);
    const cls = [];
    if (wd >= 5) cls.push('we');
    if (holiday) cls.push('hd');
    const label = WD_SHORT[wd] + ' ' + p2(ymd(r.dn).d) + '.';
    if (!r.inWin) { rows += '<tr class="na"><td>' + label + '</td><td colspan="5">–</td></tr>'; continue; }
    let von = '', bis = '', pause = '', std = '', note = '';
    if (r.cat === 'work') {
      const ens = r.entries.slice().sort((a, b) => parseHM(a.start) - parseHM(b.start));
      von = ens.map(x => x.start).join(' / ');
      bis = ens.map(x => x.end).join(' / ');
      pause = fmtPause(ens.reduce((t, x) => t + (+x.pause || 0), 0));
      std = fmtH(r.work);
      const names = ens.map(x => (getPos(x.pos) || { name: '?' }).name).filter((n, i, a) => a.indexOf(n) === i);
      note = names.join(', ') + (holiday ? ' · Feiertag' : '');
    } else {
      const map = { urlaub: 'Urlaub', krank: 'Krankenstand', za: 'Zeitausgleich', feiertag: 'Feiertag (Gutschrift)', ruhetag: 'Ruhetag' };
      if (map[r.cat]) note = map[r.cat];
      else if (r.cat === 'nocount') note = (ABS_TYPES[r.abs] || 'Abwesenheit') + ' (nicht angerechnet)';
      else if (holiday) note = 'Feiertag';
      else if (r.cat === 'frei') note = 'frei';
      if (r.credit > 0) std = '(' + fmtH(r.credit) + ')';
      else if (r.cat === 'za') std = '–';
      if (r.cat === 'urlaub' || r.cat === 'krank' || r.cat === 'za' || r.cat === 'feiertag') cls.push('ab');
    }
    rows += '<tr class="' + cls.join(' ') + '"><td>' + label + '</td><td>' + esc(von) + '</td><td>' + esc(bis) + '</td><td>' + pause + '</td><td class="r">' + std + '</td><td class="nt">' + esc(note) + '</td></tr>';
  }
  const t = s.t;
  let foot = '<tr class="sum"><td colspan="4">Gearbeitet (' + t.workDays + ' Tage)</td><td class="r">' + fmtH(t.work) + '</td><td></td></tr>';
  if (t.credit > 0) {
    const parts = [];
    if (t.vacDays) parts.push(t.vacDays + ' Urlaub');
    if (t.sickDays) parts.push(t.sickDays + ' Krank');
    if (t.holDays) parts.push(t.holDays + ' Feiertag');
    foot += '<tr class="sum"><td colspan="4">Gutschrift</td><td class="r">' + fmtH(t.credit) + '</td><td class="nt">' + parts.join(', ') + '</td></tr>';
  }
  return '<div class="sheet"><div class="sh-head"><div><b>' + esc(e.name) + '</b><span>' + esc(e.type) + ' · ' + fmtNum(e.weekly, 1).replace(',0', '') + ' Std./Woche</span></div><div class="sh-per">' + MONTHS[m - 1] + ' ' + y + '</div></div>' +
    '<table><thead><tr><th>Tag</th><th>von</th><th>bis</th><th>Pause</th><th class="r">Std.</th><th>Vermerk</th></tr></thead><tbody>' + rows + '</tbody><tfoot>' + foot + '</tfoot></table></div>';
}

function summaryHtml(y, m, list) {
  let tot = { soll: 0, work: 0, credit: 0, ist: 0, saldo: 0 };
  const rows = list.map(e => {
    const s = monthStats(e, y, m), t = s.t, v = s.vac;
    for (const k in tot) tot[k] += t[k];
    return '<tr><td><b>' + esc(e.name) + '</b><small>' + esc(e.type) + '</small></td><td class="r">' + fmtNum(e.weekly, 1).replace(',0', '') + '</td>' +
      '<td class="r">' + fmtH(t.soll) + '</td><td class="r">' + fmtH(t.work) + '</td><td class="r">' + (t.credit ? fmtH(t.credit) : '–') + '</td><td class="r"><b>' + fmtH(t.ist) + '</b></td>' +
      '<td class="r ' + saldoClass(t.saldo) + '"><b>' + fmtSigned(t.saldo) + '</b></td>' +
      '<td class="r ' + saldoClass(s.acc.konto) + '"><b>' + fmtSigned(s.acc.konto) + '</b></td>' +
      '<td class="r">' + (t.vacDays || '–') + '</td><td class="r">' + (t.sickDays || '–') + '</td>' +
      '<td class="r">' + (v ? (v.final ? fmtDaysExact(v.entitlement + v.carry) : fmtDays(v.entitlement + v.carry)) + '<small>' + (v.final ? 'aliquot bis ' + fmtDM(v.endDay) : 'Jahr ab ' + fmtDM(v.yStart)) + '</small>' : '–') + '</td>' +
      '<td class="r">' + (v ? (v.final ? fmtDaysExact(v.used) : fmtDays(v.used)) : '–') + '</td>' +
      '<td class="r"><b>' + (v ? (v.final ? fmtDaysExact(v.rest) : fmtDays(v.rest)) : '–') + '</b>' +
      (v && v.final ? '<small>' + (v.rest > 0.004 ? 'zur Auszahlung' : v.rest < -0.004 ? 'zu viel genommen' : 'aufgebraucht') + '</small>' : v && v.later ? '<small>' + fmtDays(v.later) + ' danach geplant</small>' : '') + '</td></tr>';
  }).join('');
  return '<table class="sum-table"><thead><tr><th rowspan="2">Mitarbeiter</th><th rowspan="2" class="r">Std./Woche</th>' +
    '<th colspan="5" class="grp">Arbeitszeit im Monat (Std.)</th><th rowspan="2" class="r">Zeitkonto gesamt (Std.)</th>' +
    '<th colspan="2" class="grp">Tage im Monat</th><th colspan="3" class="grp">Urlaub im Urlaubsjahr (Tage)</th></tr>' +
    '<tr><th class="r">Soll</th><th class="r">Gearbeitet</th><th class="r">Gutschrift</th><th class="r">Ist</th><th class="r">Plus / Minus</th>' +
    '<th class="r">Urlaub</th><th class="r">Krank</th><th class="r">Anspruch inkl. Übertrag</th><th class="r">Genommen</th><th class="r">Resturlaub</th></tr></thead>' +
    '<tbody>' + rows + '</tbody><tfoot><tr><td>Summe</td><td></td><td class="r">' + fmtH(tot.soll) + '</td><td class="r">' + fmtH(tot.work) + '</td><td class="r">' + fmtH(tot.credit) + '</td><td class="r">' + fmtH(tot.ist) + '</td><td class="r ' + saldoClass(tot.saldo) + '">' + fmtSigned(tot.saldo) + '</td><td colspan="6"></td></tr></tfoot></table>' +
    '<div class="notes"><b>So wird gerechnet:</b> Soll = Wochenstunden × Kalendertage des Monats ÷ 7. Gearbeitet = Dienste von–bis abzüglich Pause. ' +
    'Gutschrift = Urlaub, Krankenstand und Feiertag/Betriebsruhe mit den Stunden eines durchschnittlichen Arbeitstages (Wochenstunden ÷ Arbeitstage pro Woche). ' +
    'Ist = Gearbeitet + Gutschrift. Plus/Minus = Ist − Soll. Zeitkonto gesamt = Startsaldo + Plus/Minus seit Beginn der Aufzeichnung. ' +
    'Urlaubsjahr = ab dem Jahrestag des Eintritts; an diesem Tag wird der Jahresanspruch neu gutgeschrieben. ' +
    'Resturlaub = Anspruch + Übertrag − genommene Urlaubstage (bis Monatsende); bereits danach geplante Urlaubstage sind gesondert ausgewiesen. ' +
    'Beim Austritt gilt der Anspruch des letzten Urlaubsjahres aliquot (Tage des Arbeitsverhältnisses ÷ Tage des Urlaubsjahres × Jahresanspruch).</div>' + exitBlockHtml(y, m, list);
}

// Urlaubsabrechnung der Mitarbeiter, die in diesem Monat ausscheiden
function exitBlockHtml(y, m, list) {
  const a = monthStart(y, m), b = monthEnd(y, m);
  const rows = list.filter(e => e.to && toDn(e.to) >= a && toDn(e.to) <= b).map(e => {
    const ex = toDn(e.to), v = vacationInfo(e, ex);
    if (!v) return '';
    const res = v.rest;
    return '<tr><td><b>' + esc(e.name) + '</b></td><td>' + fmtDate(ex) + '</td><td>' + fmtDate(v.yStart) + ' – ' + fmtDate(v.yEnd) + '</td><td class="r">' + fmtDays(v.fullEntitlement) + '</td>' +
      '<td class="r">' + v.daysWorked + ' / ' + v.daysInYear + '</td><td class="r"><b>' + fmtDaysExact(v.entitlement) + '</b></td><td class="r">' + fmtDaysExact(v.carry) + '</td><td class="r">' + fmtDaysExact(v.used) + '</td>' +
      '<td class="r ' + (res > 0.004 ? 'plus' : res < -0.004 ? 'minus' : 'zero') + '"><b>' + (res > 0.004 ? fmtDaysExact(res) + ' Tage zur Auszahlung' : res < -0.004 ? fmtDaysExact(-res) + ' Tage zu viel genommen' : 'aufgebraucht') + '</b></td></tr>';
  }).join('');
  if (!rows) return '';
  return '<h3 class="exit-h">Austritte in diesem Monat: Urlaubsabrechnung</h3>' +
    '<table class="sum-table exit"><thead><tr><th>Mitarbeiter</th><th>Austritt</th><th>Urlaubsjahr</th><th class="r">Jahresanspruch</th><th class="r">Tage im Urlaubsjahr</th><th class="r">Anspruch aliquot</th><th class="r">Übertrag Vorjahre</th><th class="r">Genommen</th><th class="r">Ergebnis</th></tr></thead><tbody>' + rows + '</tbody></table>' +
    '<div class="notes">Anspruch aliquot = Jahresanspruch × Tage des Arbeitsverhältnisses im Urlaubsjahr ÷ Tage des Urlaubsjahres. Ergebnis = Übertrag + Anspruch aliquot − genommen. Rundung und rechtliche Prüfung bitte mit der Lohnverrechnung abstimmen.</div>';
}

VIEWS.report = function () {
  const { y, m } = ui.month, S = state.settings;
  const list = reportEmployees(y, m);
  const bar = '<div class="toolbar no-print">' + monthNavHtml() +
    '<div class="tools"><button class="btn primary" data-act="print">Drucken / Als PDF speichern</button></div></div>';
  if (!list.length) return bar + '<section class="card"><p class="muted pad">Für ' + MONTHS[m - 1] + ' ' + y + ' liegen keine Daten vor. Mitarbeiter werden erst ab dem Tag nach ihrem „Stand per“ ausgewertet (siehe Mitarbeiter → Stände übernehmen).</p></section>';
  const created = fmtDate(todayDn());
  const head = '<div class="rp-head"><div><b>' + esc(S.name) + '</b> · Monatsauswertung ' + MONTHS[m - 1] + ' ' + y + '</div><div>Erstellt am ' + created + '</div></div>';
  const stats = new Map(list.map(e => [e.id, monthStats(e, y, m)]));
  let pages = '';
  for (let i = 0; i < list.length; i += 2) {
    pages += '<section class="rpage">' + head + '<div class="sheets">' + list.slice(i, i + 2).map(e => sheetHtml(e, y, m, stats.get(e.id))).join('') + '</div></section>';
  }
  pages += '<section class="rpage summary">' + head + '<h2>Zusammenfassung ' + MONTHS[m - 1] + ' ' + y + '</h2>' + summaryHtml(y, m, list) + '</section>';
  return bar + '<div class="report">' + pages + '</div>';
};
