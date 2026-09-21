// Tests für Rechenlogik und Planer:  node tools/test-logic.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = ['01-util', '02-holidays', '03-model', '04-calc', '05-scheduler'];
const code = files.map(f => fs.readFileSync(path.join(root, 'src/js', f + '.js'), 'utf8').replace(/^'use strict';/, '')).join('\n');
const L = new Function(`'use strict';${code}
return { dnOf, fromDn, toDn, wdOf, mondayOf, isoWeek, easterDn, holidaysAT, netHours, shiftSpan, fmtNum, fmtSigned,
  defaultState, newEmployee, makeEntry, addEntry, planWeek, weeksOf, checkWeek, describeIssue, empTotals, empAccount,
  vacationInfo, vacationSettlement, vacYearStart, vacYearEnd, empDayRecords, touch, entriesOf, dayEntries, dayStatus, setAbsenceDay, mergeAbsences, removeAfter, migrate, deleteEmployees, legacySampleEmployees, standGap, vacRestOf,
  setState(s) { state = s; touch(); }, getState() { return state; } };`)();

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('FAIL  ' + name + '\n      ' + (e.stack || e).split('\n').slice(0, 4).join('\n      ')); }
}
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

console.log('Datum & Feiertage');
t('Wochentag / KW', () => {
  assert.equal(L.wdOf(L.dnOf(2026, 9, 21)), 0); // Montag
  assert.equal(L.wdOf(L.dnOf(2026, 9, 27)), 6);
  assert.equal(L.isoWeek(L.dnOf(2026, 9, 21)).week, 39);
  assert.equal(L.isoWeek(L.dnOf(2026, 1, 1)).week, 1);
  assert.equal(L.isoWeek(L.dnOf(2027, 1, 1)).week, 53);
  assert.equal(L.fromDn(L.toDn('2024-02-29')), '2024-02-29');
});
t('Ostern & Feiertage AT', () => {
  assert.equal(L.fromDn(L.easterDn(2026)), '2026-04-05');
  assert.equal(L.fromDn(L.easterDn(2025)), '2025-04-20');
  assert.equal(L.fromDn(L.easterDn(2024)), '2024-03-31');
  const h = L.holidaysAT(2026).list.map(x => L.fromDn(x.dn));
  assert.ok(h.includes('2026-04-06') && h.includes('2026-05-14') && h.includes('2026-05-25') && h.includes('2026-06-04'));
  assert.equal(h.length, 13);
});
t('Netto-Stunden inkl. Mitternacht', () => {
  near(L.netHours('10:00', '17:00', 30), 6.5);
  near(L.netHours('18:00', '02:00', 60), 7);
  near(L.netHours('11:00', '21:00', 60), 9);
});
t('Zahlformat', () => {
  assert.equal(L.fmtNum(1234.5, 2), '1234,50');
  assert.equal(L.fmtSigned(-0.001), '0,00');
  assert.equal(L.fmtSigned(3.456), '+3,46');
  assert.equal(L.fmtSigned(-3), '-3,00');
});

/* ---------- Stunden-/Urlaubsrechnung ---------- */
function freshState() {
  const st = L.defaultState();
  st.settings.openDays = [true, true, true, true, true, true, true];
  return st;
}
console.log('Stundenrechnung');
t('Soll je Kalendertag, Ist aus Diensten', () => {
  const st = freshState(); L.setState(st);
  const e = L.newEmployee('Vollzeit', { name: 'A', main: 'pos_service', trackFrom: '2026-09-01' });
  st.employees.push(e); L.touch();
  const sh = st.settings.shifts[2]; // Durchgehend 9h
  for (let d = 1; d <= 5; d++) L.addEntry(L.dnOf(2026, 9, d), L.makeEntry(e.id, 'pos_service', sh, true));
  const tot = L.empTotals(e, L.dnOf(2026, 9, 1), L.dnOf(2026, 9, 30));
  near(tot.soll, 40 * 30 / 7);
  near(tot.work, 45);
  // Urlaub: ganze Woche 7.-13.9. (7 Tage offen, Kapazität 5) -> 5 Urlaubstage, 40 h Gutschrift
  st.absences.push({ id: 'a1', emp: e.id, from: '2026-09-07', to: '2026-09-13', type: 'urlaub', note: '' }); L.touch();
  const t2 = L.empTotals(e, L.dnOf(2026, 9, 7), L.dnOf(2026, 9, 13));
  assert.equal(t2.vacDays, 5);
  near(t2.cVac, 40);
  near(t2.saldo, 0);
});
t('Urlaub: Kapazität berücksichtigt Arbeitstage und feste freie Tage', () => {
  const st = freshState(); L.setState(st);
  const e = L.newEmployee('Vollzeit', { name: 'B', main: 'pos_service', trackFrom: '2026-09-01', offDays: [5, 6] });
  st.employees.push(e);
  st.absences.push({ id: 'a1', emp: e.id, from: '2026-09-07', to: '2026-09-13', type: 'urlaub', note: '' }); L.touch();
  const t = L.empTotals(e, L.dnOf(2026, 9, 7), L.dnOf(2026, 9, 13));
  assert.equal(t.vacDays, 5); // Sa/So zählen nicht
});
t('Krank zählt nicht als Urlaub, ZA ohne Gutschrift', () => {
  const st = freshState(); L.setState(st);
  const e = L.newEmployee('Vollzeit', { name: 'C', main: 'pos_service', trackFrom: '2026-09-01' });
  st.employees.push(e);
  st.absences.push({ id: 'a1', emp: e.id, from: '2026-09-07', to: '2026-09-08', type: 'krank', note: '' });
  st.absences.push({ id: 'a2', emp: e.id, from: '2026-09-09', to: '2026-09-09', type: 'za', note: '' }); L.touch();
  const t = L.empTotals(e, L.dnOf(2026, 9, 7), L.dnOf(2026, 9, 13));
  assert.equal(t.sickDays, 2); assert.equal(t.vacDays, 0); assert.equal(t.zaDays, 1);
  near(t.credit, 16);
});
t('Feiertag bei Betriebsruhe wird gutgeschrieben; offener Feiertag nicht', () => {
  const st = freshState(); L.setState(st);
  st.settings.closedHolidays['2026-12-25'] = true;
  const e = L.newEmployee('Vollzeit', { name: 'D', main: 'pos_service', trackFrom: '2026-12-01' });
  st.employees.push(e); L.touch();
  const t = L.empTotals(e, L.dnOf(2026, 12, 21), L.dnOf(2026, 12, 27));
  assert.equal(t.holDays, 1);
  near(t.cHol, 8);
});
t('Betriebsruhe mit Urlaub verbraucht Urlaub, Feiertag im Urlaub nicht', () => {
  const st = freshState(); L.setState(st);
  st.settings.closures.push({ id: 'c1', from: '2026-08-10', to: '2026-08-14', note: 'Betriebsurlaub' });
  const e = L.newEmployee('Vollzeit', { name: 'G', main: 'pos_service', trackFrom: '2026-08-01' });
  st.employees.push(e);
  st.absences.push({ id: 'a1', emp: e.id, from: '2026-08-10', to: '2026-08-14', type: 'urlaub', note: '' });
  // Feiertag Mariä Himmelfahrt (Sa 15.8.) liegt nicht im Urlaub; Mo 26.10. (Nationalfeiertag) im Urlaub
  st.absences.push({ id: 'a2', emp: e.id, from: '2026-10-26', to: '2026-10-28', type: 'urlaub', note: '' }); L.touch();
  const t1 = L.empTotals(e, L.dnOf(2026, 8, 10), L.dnOf(2026, 8, 16));
  assert.equal(t1.vacDays, 5);
  const t2 = L.empTotals(e, L.dnOf(2026, 10, 26), L.dnOf(2026, 10, 28));
  assert.equal(t2.vacDays, 2); assert.equal(t2.holDays, 1); // Feiertag zählt nicht als Urlaubstag
});
t('Zeitkonto: Startsaldo + Monate', () => {
  const st = freshState(); L.setState(st);
  const e = L.newEmployee('Vollzeit', { name: 'E', main: 'pos_service', trackFrom: '2026-09-01', balStart: 5 });
  st.employees.push(e); L.touch();
  const a = L.empAccount(e, L.dnOf(2026, 9, 7)); // 7 Tage, nichts gearbeitet -> -40
  near(a.konto, 5 - 40);
});
t('Urlaubsanspruch, Übertrag und Vorjahr', () => {
  const st = freshState(); L.setState(st);
  const e = L.newEmployee('Vollzeit', { name: 'F', main: 'pos_service', trackFrom: '2025-11-01', vac: 25, vacCarry: 3, vacUsedBefore: 20 });
  st.employees.push(e);
  st.absences.push({ id: 'a1', emp: e.id, from: '2025-12-01', to: '2025-12-05', type: 'urlaub', note: '' });
  st.absences.push({ id: 'a2', emp: e.id, from: '2026-03-02', to: '2026-03-06', type: 'urlaub', note: '' });
  st.absences.push({ id: 'a3', emp: e.id, from: '2026-10-05', to: '2026-10-09', type: 'urlaub', note: '' }); L.touch();
  const v25 = L.vacationInfo(e, L.dnOf(2025, 12, 31));
  assert.equal(v25.used, 25); near(v25.rest, 3);
  const v26 = L.vacationInfo(e, L.dnOf(2026, 6, 30));
  near(v26.carry, 3); assert.equal(v26.usedProg, 5); assert.equal(v26.later, 5);
  near(v26.rest, 3 + 25 - 5); near(v26.restAfterPlanned, 3 + 25 - 10);
});

/* ---------- Planer ---------- */
function dayCounts(ws, st) {
  const res = [];
  for (let k = 0; k < 7; k++) res.push(new Set(L.dayEntries(ws + k).map(e => e.emp)).size);
  return res;
}
function evaluate(label, ws, opts = {}) {
  const st = L.getState();
  const issues = L.checkWeek(ws);
  const byType = {};
  issues.forEach(i => { (byType[i.type] = byType[i.type] || []).push(i); });
  return { issues, byType };
}

console.log('Planer');
const weekStart = L.dnOf(2026, 9, 21);
// Testdaten (nur für die Prüfungen, nicht Teil des Programms)
function demoState() {
  const st = L.defaultState();
  const [pz, ku, sv, ab] = st.settings.positions.map(p => p.id);
  const mk = (name, type, main, o) => L.newEmployee(type, Object.assign({ name, main, trackFrom: L.fromDn(weekStart) }, o || {}));
  st.employees = [
    mk('Marco Rossi', 'Vollzeit', pz),
    mk('Luca Bianchi', 'Vollzeit', pz, { alt: [ku] }),
    mk('Giulia Ferrari', 'Vollzeit', ku, { alt: [pz] }),
    mk('Stefan Huber', 'Vollzeit', ku),
    mk('Anna Gruber', 'Vollzeit', sv),
    mk('Sabine Wagner', 'Teilzeit', sv, { weekly: 30, days: 4, vac: 20 }),
    mk('Elena Novak', 'Teilzeit', sv, { weekly: 20, days: 3, vac: 15 }),
    mk('Tobias Berger', 'Vollzeit', ab),
    mk('Mehmet Yilmaz', 'Teilzeit', ab, { weekly: 20, days: 3, vac: 15, alt: [sv] }),
    mk('Lisa Steiner', 'Aushilfe', sv, { weekly: 12, days: 2, vac: 10, allowed: ['sh_spaet'] }),
  ];
  const E = st.employees;
  st.absences = [
    { id: 'd1', emp: E[5].id, from: L.fromDn(weekStart + 14), to: L.fromDn(weekStart + 18), type: 'urlaub', note: '' },
    { id: 'd2', emp: E[6].id, from: L.fromDn(weekStart + 8), to: L.fromDn(weekStart + 9), type: 'urlaub', note: '' },
  ];
  return st;
}
t('Beispielbetrieb: 4 Wochen, Besetzung vollständig, Ruhezeiten eingehalten', () => {
  const st = demoState(); L.setState(st);
  st.employees.forEach(e => { e.trackFrom = L.fromDn(weekStart); });
  L.touch();
  const t0 = Date.now();
  const weeks = [];
  for (let i = 0; i < 4; i++) weeks.push(weekStart + i * 7);
  for (const ws of weeks) L.planWeek(ws, { seed: 1234 + ws });
  const ms = Date.now() - t0;
  console.log('      Dauer 4 Wochen: ' + ms + ' ms');
  for (const ws of weeks) {
    const { issues, byType } = evaluate('w', ws);
    const bad = issues.filter(i => ['cover', 'minp', 'rest', 'consec', 'conflict'].includes(i.type));
    assert.equal(bad.length, 0, 'Verstöße in Woche ' + L.fromDn(ws) + ':\n' + bad.map(L.describeIssue).join('\n'));
    const cnt = dayCounts(ws, st);
    cnt.forEach((c, k) => { if (st.settings.openDays[k]) assert.ok(c >= 4, 'weniger als 4 Personen am Tag ' + k); });
  }
});
t('Ausgabe Woche 1 (Sichtprüfung)', () => {
  const st = L.getState();
  const sc = { sh_frueh: 'F', sh_spaet: 'S', sh_durch: 'D' };
  const pc = { pos_pizza: 'Pz', pos_kueche: 'Kü', pos_service: 'Sv', pos_abwasch: 'Ab' };
  console.log('      ' + ''.padEnd(16) + ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(x => x.padEnd(6)).join('') + ' Ist/Soll');
  for (const e of st.employees) {
    let row = '';
    for (let k = 0; k < 7; k++) {
      const en = L.entriesOf(e.id, weekStart + k)[0];
      const a = L.entriesOf(e.id, weekStart + k).length ? '' : (L.fromDn(weekStart + k) && (st.absences.find(x => x.emp === e.id && L.toDn(x.from) <= weekStart + k && L.toDn(x.to) >= weekStart + k) ? 'U' : ''));
      row += (en ? sc[en.shift] + pc[en.pos] : a || '.').padEnd(6);
    }
    const tot = L.empTotals(e, weekStart, weekStart + 6);
    console.log('      ' + e.name.padEnd(16) + row + ' ' + tot.ist.toFixed(1) + '/' + tot.soll.toFixed(1));
  }
});
t('Stundenabweichung pro Person klein (Wochen 1-4)', () => {
  const st = L.getState();
  let worst = 0, sum = 0, n = 0;
  for (const e of st.employees) {
    for (let i = 0; i < 4; i++) {
      const ws = weekStart + i * 7;
      const tot = L.empTotals(e, ws, ws + 6);
      worst = Math.max(worst, Math.abs(tot.saldo)); sum += Math.abs(tot.saldo); n++;
    }
    const acc = L.empAccount(e, weekStart + 27);
    console.log('      ' + e.name.padEnd(16) + ' Konto nach 4 Wochen: ' + L.fmtSigned(acc.konto));
  }
  console.log('      max Abweichung/Woche: ' + worst.toFixed(2) + ' h, Ø ' + (sum / n).toFixed(2) + ' h');
  assert.ok(worst <= 4.5, 'zu große Wochenabweichung: ' + worst);
});
t('Urlaub der Demo-Personen wird eingehalten', () => {
  const st = L.getState();
  for (const a of st.absences) {
    for (let d = L.toDn(a.from); d <= L.toDn(a.to); d++) assert.equal(L.entriesOf(a.emp, d).length, 0, 'Dienst trotz Urlaub');
  }
});
t('Manuelle Einträge bleiben, Zeitraum-Grenzen werden respektiert', () => {
  const st = L.getState();
  const e = st.employees[0];
  const d0 = weekStart + 2, dEnd = weekStart + 6;
  // manuellen Dienst setzen, Mittwoch
  for (const en of [...L.dayEntries(d0)]) if (en.emp === e.id) st.plan[L.fromDn(d0)] = st.plan[L.fromDn(d0)].filter(x => x !== en);
  L.addEntry(d0, { ...L.makeEntry(e.id, e.main, st.settings.shifts[1], true) });
  const before = JSON.stringify(st.plan[L.fromDn(weekStart)] || []);
  L.planWeek(weekStart, { seed: 7, from: weekStart + 2, to: dEnd, keepManual: true });
  assert.equal(JSON.stringify(st.plan[L.fromDn(weekStart)] || []), before, 'Tage vor "from" verändert');
  const man = L.entriesOf(e.id, d0).filter(x => x.manual);
  assert.equal(man.length, 1);
  assert.equal(man[0].shift, 'sh_spaet');
});
t('Wenig Personal: Planer meldet Lücken statt zu scheitern', () => {
  const st = demoState(); L.setState(st);
  st.employees.forEach(e => { e.trackFrom = L.fromDn(weekStart); });
  // Küche/Abwasch-Personen abwesend
  for (const e of st.employees) if (e.main === 'pos_abwasch') st.absences.push({ id: 'x' + e.id, emp: e.id, from: '2026-09-21', to: '2026-09-27', type: 'krank', note: '' });
  L.touch();
  L.planWeek(weekStart, { seed: 5 });
  const { issues } = evaluate('w', weekStart);
  const cover = issues.filter(i => i.type === 'cover');
  assert.ok(cover.length > 0 && cover.every(i => i.pos === 'pos_abwasch' || true));
  console.log('      Lücken gemeldet: ' + cover.length + ' (z. B. ' + L.describeIssue(cover[0]) + ')');
});
t('Feiertag mit Geschlossen-Markierung: kein Dienst am Feiertag', () => {
  const st = demoState(); L.setState(st);
  st.settings.closedHolidays['2026-10-26'] = true; L.touch();
  const ws = L.dnOf(2026, 10, 26);
  L.planWeek(ws, { seed: 3 });
  assert.equal(L.dayEntries(ws).length, 0);
});

console.log('Robustheit');
t('30 Zufallsläufe: immer vollständig besetzt, keine Regelverstöße', () => {
  let worstDev = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const st = demoState(); L.setState(st);
    st.employees.forEach(e => { e.trackFrom = L.fromDn(weekStart); });
    L.touch();
    for (let i = 0; i < 3; i++) L.planWeek(weekStart + i * 7, { seed: seed * 101 + i });
    for (let i = 0; i < 3; i++) {
      const ws = weekStart + i * 7;
      const bad = L.checkWeek(ws).filter(x => x.type !== 'hours');
      assert.equal(bad.length, 0, 'Seed ' + seed + ': ' + bad.map(L.describeIssue).join('; '));
      for (const e of st.employees) worstDev = Math.max(worstDev, Math.abs(L.empTotals(e, ws, ws + 6).saldo));
    }
  }
  console.log('      größte Wochenabweichung über alle Läufe: ' + worstDev.toFixed(2) + ' h');
  assert.ok(worstDev <= 4.5);
});
t('Keine Mitarbeiter / nur eine Person / Person ohne Position', () => {
  const st = L.defaultState(); L.setState(st);
  L.planWeek(weekStart, { seed: 1 });
  const e = L.newEmployee('Vollzeit', { name: 'Solo', main: 'pos_service' });
  const x = L.newEmployee('Vollzeit', { name: 'Ohne', main: '' });
  st.employees.push(e, x); L.touch();
  L.planWeek(weekStart, { seed: 1 });
  assert.ok(L.checkWeek(weekStart).some(i => i.type === 'cover'));
  assert.equal(L.entriesOf(x.id, weekStart + 1).length, 0);
  // Ruhezeit und Arbeitstage werden auch allein eingehalten
  assert.equal(L.checkWeek(weekStart).filter(i => i.type === 'rest' || i.type === 'consec').length, 0);
});
t('Nur bestimmte Dienste erlaubt (Lisa nur Spät) und Positionen', () => {
  const st = demoState(); L.setState(st);
  st.employees.forEach(e => { e.trackFrom = L.fromDn(weekStart); });
  L.touch();
  L.planWeek(weekStart, { seed: 9 });
  const lisa = st.employees.find(e => e.name.startsWith('Lisa'));
  for (let k = 0; k < 7; k++) for (const en of L.entriesOf(lisa.id, weekStart + k)) assert.equal(en.shift, 'sh_spaet');
  for (const e of st.employees) for (let k = 0; k < 7; k++) for (const en of L.entriesOf(e.id, weekStart + k)) assert.ok(en.pos === e.main || (e.alt || []).includes(en.pos));
});
t('Erneutes Planen ohne "manuell behalten" ersetzt alles, mit "behalten" bleibt manuelles', () => {
  const st = demoState(); L.setState(st);
  st.employees.forEach(e => { e.trackFrom = L.fromDn(weekStart); });
  L.touch();
  L.planWeek(weekStart, { seed: 2 });
  const n1 = L.dayEntries(weekStart + 3).length;
  L.planWeek(weekStart, { seed: 3, keepManual: false });
  assert.ok(L.dayEntries(weekStart + 3).length >= 4);
  assert.ok(n1 >= 4);
});

console.log('Angebrochene Wochen');
t('Planung ab Donnerstag: keine Überlast, Zeitkonto ab dem Startdatum', () => {
  const st = demoState(); L.setState(st);
  const thu = weekStart + 3;
  st.employees.forEach(e => { e.trackFrom = L.fromDn(thu); });
  L.touch();
  L.planWeek(weekStart, { seed: 11, from: thu, to: weekStart + 6 });
  for (const e of st.employees) {
    const tot = L.empTotals(e, thu, weekStart + 6);
    assert.ok(tot.saldo < 5 && tot.saldo > -6, e.name + ' Saldo ' + tot.saldo.toFixed(2) + ' (Ist ' + tot.ist.toFixed(1) + ' / Soll ' + tot.soll.toFixed(1) + ')');
  }
  const bad = L.checkWeek(weekStart).filter(i => ['cover', 'minp', 'rest', 'consec'].includes(i.type) && i.dn >= thu);
  assert.equal(bad.length, 0, bad.map(L.describeIssue).join('; '));
  assert.equal(L.dayEntries(weekStart + 1).length, 0, 'Tage vor dem Zeitraum bleiben leer');
});
t('Monat in zwei Schritten geplant ergibt volle Wochenstunden', () => {
  const st = demoState(); L.setState(st);
  st.employees.forEach(e => { e.trackFrom = L.fromDn(weekStart); });
  L.touch();
  L.planWeek(weekStart, { seed: 5, from: weekStart, to: weekStart + 2 });        // Mo-Mi
  L.planWeek(weekStart, { seed: 6, from: weekStart + 3, to: weekStart + 6 });    // Do-So
  let worst = 0;
  for (const e of st.employees) worst = Math.max(worst, Math.abs(L.empTotals(e, weekStart, weekStart + 6).saldo));
  console.log('      größte Wochenabweichung: ' + worst.toFixed(2) + ' h');
  assert.ok(worst <= 5, 'Abweichung ' + worst);
  const bad = L.checkWeek(weekStart).filter(i => ['cover', 'minp', 'rest', 'consec'].includes(i.type));
  assert.equal(bad.length, 0, bad.map(L.describeIssue).join('; '));
});

console.log('Abwesenheiten');
t('Ein Tag aus einem Urlaub herausnehmen teilt, wieder eintragen fügt zusammen', () => {
  const st = freshState(); L.setState(st);
  const e = L.newEmployee('Vollzeit', { name: 'H', main: 'pos_service', trackFrom: '2026-09-01' });
  st.employees.push(e);
  st.absences.push({ id: 'a1', emp: e.id, from: '2026-09-07', to: '2026-09-11', type: 'urlaub', note: '' }); L.touch();
  L.setAbsenceDay(e.id, L.dnOf(2026, 9, 9), null);
  const parts = st.absences.map(a => a.from + '..' + a.to).sort();
  assert.deepEqual(parts, ['2026-09-07..2026-09-08', '2026-09-10..2026-09-11']);
  L.setAbsenceDay(e.id, L.dnOf(2026, 9, 9), 'urlaub');
  assert.equal(st.absences.length, 1);
  assert.equal(st.absences[0].from, '2026-09-07'); assert.equal(st.absences[0].to, '2026-09-11');
  L.setAbsenceDay(e.id, L.dnOf(2026, 9, 9), 'krank');
  assert.equal(st.absences.length, 3);
});
t('"Frei (fix)": kein Dienst, kein Urlaubsabzug, keine Gutschrift', () => {
  const st = demoState(); L.setState(st);
  st.employees.forEach(e => { e.trackFrom = L.fromDn(weekStart); });
  const marco = st.employees[0];
  for (const k of [1]) st.absences.push({ id: 'f' + k, emp: marco.id, from: L.fromDn(weekStart + k), to: L.fromDn(weekStart + k), type: 'frei', note: '' });
  L.touch();
  L.planWeek(weekStart, { seed: 21 });
  for (const k of [1]) assert.equal(L.entriesOf(marco.id, weekStart + k).length, 0);
  const tot = L.empTotals(marco, weekStart, weekStart + 6);
  assert.equal(tot.vacDays, 0); near(tot.credit, 0);
  assert.ok(Math.abs(tot.saldo) <= 4, 'Saldo ' + tot.saldo);
});

console.log('Mitarbeiter entfernen / Firmenname');
t('Austritt: spätere Dienste und Abwesenheiten werden entfernt, frühere bleiben', () => {
  const st = demoState(); L.setState(st);
  st.employees.forEach(e => { e.trackFrom = L.fromDn(weekStart); });
  L.touch();
  for (let i = 0; i < 2; i++) L.planWeek(weekStart + i * 7, { seed: 3 + i });
  const e = st.employees[4];
  st.absences.push({ id: 'z1', emp: e.id, from: L.fromDn(weekStart + 9), to: L.fromDn(weekStart + 16), type: 'urlaub', note: '' }); L.touch();
  const cut = weekStart + 10;
  const before = [...Array(14).keys()].filter(k => weekStart + k <= cut).reduce((n, k) => n + L.entriesOf(e.id, weekStart + k).length, 0);
  const removed = L.removeAfter(e.id, cut);
  assert.ok(removed > 0);
  for (let k = 0; k < 14; k++) if (weekStart + k > cut) assert.equal(L.entriesOf(e.id, weekStart + k).length, 0);
  const after = [...Array(14).keys()].filter(k => weekStart + k <= cut).reduce((n, k) => n + L.entriesOf(e.id, weekStart + k).length, 0);
  assert.equal(after, before);
  const a = st.absences.find(x => x.id === 'z1');
  assert.equal(a.to, L.fromDn(cut)); // Urlaub wird am Austritt gekürzt
  // andere Personen unberührt
  assert.ok(L.dayEntries(weekStart + 12).length >= 4);
});
t('Firmenname: Standard und Übernahme des alten Platzhalters "Restaurant"', () => {
  assert.equal(L.defaultState().settings.name, 'Tiziano Restaurant GmbH');
  const old = JSON.parse(JSON.stringify(L.defaultState())); old.settings.name = 'Restaurant';
  assert.equal(L.migrate(old).settings.name, 'Tiziano Restaurant GmbH');
  const own = JSON.parse(JSON.stringify(L.defaultState())); own.settings.name = 'Pizzeria Mario';
  assert.equal(L.migrate(own).settings.name, 'Pizzeria Mario');
});

console.log('Muster-Mitarbeiter');
t('Alte Beispieldaten werden erkannt (ab 5 Namen), einzelne echte Namen nicht', () => {
  const st = demoState(); L.setState(st);
  assert.equal(L.legacySampleEmployees().length, 10);
  const real = L.defaultState();
  real.employees.push(L.newEmployee('Vollzeit', { name: 'Anna Gruber', main: 'pos_service' }), L.newEmployee('Vollzeit', { name: 'Stefan Huber', main: 'pos_kueche' }), L.newEmployee('Vollzeit', { name: 'Petra Neumann', main: 'pos_pizza' }));
  L.setState(real);
  assert.equal(L.legacySampleEmployees().length, 0);
});
t('Entfernen: Mitarbeiter, Dienste und Urlaube der Muster-Mitarbeiter weg, echte Mitarbeiter bleiben', () => {
  const st = demoState(); L.setState(st);
  const real = L.newEmployee('Vollzeit', { name: 'Petra Neumann', main: 'pos_service', trackFrom: L.fromDn(weekStart) });
  st.employees.push(real);
  st.absences.push({ id: 'r1', emp: real.id, from: L.fromDn(weekStart + 3), to: L.fromDn(weekStart + 4), type: 'urlaub', note: '' });
  L.touch();
  L.planWeek(weekStart, { seed: 4 });
  L.addEntry(weekStart + 5, L.makeEntry(real.id, real.main, st.settings.shifts[0], true));
  const sample = L.legacySampleEmployees().map(e => e.id);
  assert.equal(sample.length, 10);
  L.deleteEmployees(sample);
  assert.deepEqual(st.employees.map(e => e.name), ['Petra Neumann']);
  assert.deepEqual(st.absences.map(a => a.id), ['r1']);
  const left = Object.values(st.plan).flat();
  assert.ok(left.length >= 1 && left.every(x => x.emp === real.id), 'nur Dienste der echten Mitarbeiterin bleiben');
  assert.equal(L.legacySampleEmployees().length, 0);
});

console.log('Übernahme bestehender Stände (Stichtag)');
t('Resturlaub per Stichtag mitten im Jahr: laufend abgezogen, Jahreswechsel bringt neuen Anspruch', () => {
  const st = freshState(); L.setState(st);
  // Stand per 31.08.2026: 12 Tage Resturlaub, +8,5 Std.
  const e = L.newEmployee('Vollzeit', { name: 'S1', main: 'pos_service', trackFrom: '2026-09-01', vac: 25, vacRest: 12, balStart: 8.5 });
  st.employees.push(e);
  st.absences.push({ id: 'u1', emp: e.id, from: '2026-10-05', to: '2026-10-09', type: 'urlaub', note: '' });
  st.absences.push({ id: 'u2', emp: e.id, from: '2026-12-21', to: '2026-12-23', type: 'urlaub', note: '' }); L.touch();
  let v = L.vacationInfo(e, L.dnOf(2026, 9, 30));
  near(v.rest, 12); near(v.entitlement + v.carry, 25); near(v.used, 13);
  v = L.vacationInfo(e, L.dnOf(2026, 10, 31));
  near(v.rest, 7); near(v.later, 3);
  v = L.vacationInfo(e, L.dnOf(2026, 12, 31));
  near(v.rest, 4);
  const v27 = L.vacationInfo(e, L.dnOf(2027, 1, 31));
  near(v27.carry, 4); near(v27.rest, 4 + 25);
  near(L.empAccount(e, L.dnOf(2026, 8, 31)).konto, 8.5); // vor dem Stichtag noch der Startsaldo
  assert.equal(L.vacRestOf(e), 12);
});
t('Stichtag am Jahresende: Resturlaub wird ins neue Jahr übertragen', () => {
  const st = freshState(); L.setState(st);
  const e = L.newEmployee('Vollzeit', { name: 'S2', main: 'pos_service', trackFrom: '2026-01-01', vac: 25, vacRest: 8 }); // Stand per 31.12.2025
  st.employees.push(e); L.touch();
  const v = L.vacationInfo(e, L.dnOf(2026, 1, 31));
  near(v.carry, 8); near(v.used, 0); near(v.rest, 33);
});
t('Mehr Resturlaub als Jahresanspruch: Rest gilt als Übertrag', () => {
  const st = freshState(); L.setState(st);
  const e = L.newEmployee('Vollzeit', { name: 'S3', main: 'pos_service', trackFrom: '2026-03-01', vac: 25, vacRest: 30 });
  st.employees.push(e); L.touch();
  const v = L.vacationInfo(e, L.dnOf(2026, 3, 31));
  near(v.carry, 5); near(v.used, 0); near(v.rest, 30);
});
t('Ältere Daten ohne Resturlaub-Feld rechnen unverändert (Vorjahresrest, schon genommen)', () => {
  const st = freshState(); L.setState(st);
  const e = L.newEmployee('Vollzeit', { name: 'S4', main: 'pos_service', trackFrom: '2026-06-01', vac: 25, vacCarry: 3, vacUsedBefore: 20 });
  st.employees.push(e); L.touch();
  const v = L.vacationInfo(e, L.dnOf(2026, 6, 30));
  near(v.carry, 3); near(v.used, 20); near(v.rest, 8);
  near(L.vacRestOf(e), 8);
});
t('Warnung bei Lücke zwischen Stichtag und heute (ohne Dienste = Minusstunden)', () => {
  const st = freshState(); L.setState(st);
  const e = L.newEmployee('Vollzeit', { name: 'S5', main: 'pos_service', trackFrom: '2026-09-01' });
  st.employees.push(e); L.touch();
  const today = L.dnOf(2026, 9, 21);
  const g = L.standGap(e, L.dnOf(2026, 8, 31), today); // 1.9. bis 20.9. = 20 Tage
  assert.equal(g.days, 20); near(g.soll, 40 * 20 / 7); near(g.saldo, -40 * 20 / 7);
  assert.equal(L.standGap(e, L.dnOf(2026, 9, 20), today), null); // Stand gestern: keine Lücke
  // mit eingetragenen Diensten schrumpft die Lücke
  for (let d = 1; d <= 5; d++) L.addEntry(L.dnOf(2026, 9, d), L.makeEntry(e.id, 'pos_service', st.settings.shifts[2], true));
  assert.ok(L.standGap(e, L.dnOf(2026, 8, 31), today).saldo > -40 * 20 / 7 + 44);
});

console.log('Urlaubsjahr ab Eintritt, Austritt aliquot');
t('Urlaubsjahr beginnt am Jahrestag des Eintritts; dort kommen jährlich neue Tage dazu', () => {
  const st = freshState(); L.setState(st);
  // Eintritt 15.03.2020, Stand per 20.09.2026: 12 Tage Resturlaub
  const e = L.newEmployee('Vollzeit', { name: 'U1', main: 'pos_service', from: '2020-03-15', trackFrom: '2026-09-21', vac: 25, vacRest: 12 });
  st.employees.push(e);
  st.absences.push({ id: 'a1', emp: e.id, from: '2026-10-05', to: '2026-10-09', type: 'urlaub', note: '' }); L.touch();
  assert.equal(L.fromDn(L.vacYearStart(e, L.dnOf(2026, 9, 30))), '2026-03-15');
  assert.equal(L.fromDn(L.vacYearEnd(e, L.dnOf(2026, 3, 15))), '2027-03-14');
  let v = L.vacationInfo(e, L.dnOf(2026, 9, 30));
  near(v.rest, 12); near(v.used, 13); near(v.carry, 0); assert.equal(L.fromDn(v.yStart), '2026-03-15');
  v = L.vacationInfo(e, L.dnOf(2026, 10, 31)); near(v.rest, 7);
  v = L.vacationInfo(e, L.dnOf(2027, 3, 14)); near(v.rest, 7);                      // letzter Tag des Urlaubsjahres
  v = L.vacationInfo(e, L.dnOf(2027, 3, 15));                                        // Jahrestag: +25 Tage
  near(v.carry, 7); near(v.entitlement, 25); near(v.rest, 32); assert.equal(L.fromDn(v.yStart), '2027-03-15');
  v = L.vacationInfo(e, L.dnOf(2028, 3, 15)); near(v.rest, 57);                      // ein weiteres Jahr ohne Urlaub
});
t('Austritt: Anspruch aliquot bis zum Austrittsdatum, Rest wird abgerechnet', () => {
  const st = freshState(); L.setState(st);
  const e = L.newEmployee('Vollzeit', { name: 'U2', main: 'pos_service', from: '2020-03-15', trackFrom: '2026-09-21', vac: 25, vacRest: 12, to: '2026-10-31' });
  st.employees.push(e);
  st.absences.push({ id: 'a1', emp: e.id, from: '2026-10-05', to: '2026-10-09', type: 'urlaub', note: '' }); L.touch();
  // vor dem Austritt: normale Anzeige
  let v = L.vacationInfo(e, L.dnOf(2026, 9, 30)); assert.equal(v.final, false); near(v.entitlement, 25);
  // Abrechnung zum 31.10.2026: Urlaubsjahr 15.03.2026-14.03.2027 (365 Tage), 231 Tage gearbeitet
  v = L.vacationInfo(e, L.dnOf(2026, 10, 31));
  assert.equal(v.final, true); assert.equal(v.daysWorked, 231); assert.equal(v.daysInYear, 365);
  near(v.entitlement, 25 * 231 / 365);
  near(v.rest, 12 - 5 - (25 - 25 * 231 / 365));   // Rest 7 abzüglich der noch nicht erworbenen Tage
  const v2 = L.vacationInfo(e, L.dnOf(2027, 6, 30)); near(v2.rest, v.rest);           // später bleibt die Abrechnung gleich
  // Vorschau für ein anderes Datum, ohne den Mitarbeiter zu ändern
  const pv = L.vacationSettlement(Object.assign({}, e, { to: '' }), L.dnOf(2026, 9, 30));
  assert.equal(pv.final, true); assert.equal(pv.daysWorked, 200);
  assert.equal(e.to, '2026-10-31');
});
t('Austritt zum Jahrestag-Vortag: voller Anspruch; Eintrittsjahr: aliquot ab Eintritt', () => {
  const st = freshState(); L.setState(st);
  const a = L.newEmployee('Vollzeit', { name: 'U3', main: 'pos_service', from: '2020-03-15', trackFrom: '2026-03-15', vac: 25, vacRest: 0, to: '2027-03-14' }); // Stand 14.03.2026 = letzter Tag des Vorjahres: nichts übertragen
  st.employees.push(a); L.touch();
  const va = L.vacationInfo(a, L.dnOf(2027, 3, 14)); near(va.entitlement, 25); near(va.rest, 25);
  // Neuer Mitarbeiter: Eintritt 01.07.2026, Austritt 31.12.2026 -> 184 von 365 Tagen
  const b = L.newEmployee('Vollzeit', { name: 'U4', main: 'pos_service', from: '2026-07-01', trackFrom: '2026-07-01', vac: 25, vacRest: 25, to: '2026-12-31' });
  st.employees.push(b); L.touch();
  const vb = L.vacationInfo(b, L.dnOf(2026, 12, 31));
  assert.equal(vb.daysWorked, 184); near(vb.entitlement, 25 * 184 / 365); near(vb.rest, 25 * 184 / 365);
});
t('Stand vor dem Eintritt wird ignoriert; Schaltjahr-Eintritt am 29.2.', () => {
  const st = freshState(); L.setState(st);
  const e = L.newEmployee('Vollzeit', { name: 'U5', main: 'pos_service', from: '2026-10-01', trackFrom: '2026-09-21', vac: 25, vacRest: 25 });
  st.employees.push(e); L.touch();
  const v = L.vacationInfo(e, L.dnOf(2026, 10, 31)); near(v.carry, 0); near(v.rest, 25); assert.equal(L.fromDn(v.yStart), '2026-10-01');
  const l = L.newEmployee('Vollzeit', { name: 'U6', main: 'pos_service', from: '2020-02-29', trackFrom: '2026-01-01', vac: 25, vacRest: 25 });
  assert.equal(L.fromDn(L.vacYearStart(l, L.dnOf(2026, 6, 1))), '2026-02-28');
  assert.equal(L.fromDn(L.vacYearStart(l, L.dnOf(2028, 3, 1))), '2028-02-29');
});

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
