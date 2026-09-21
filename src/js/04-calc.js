'use strict';
/* ===== Stunden- und Urlaubsrechnung =====
 *
 * Soll     = Wochenstunden / 7 je Kalendertag (im Zeitraum der Beschäftigung / Zeitkonto-Führung)
 * gearbeitet = Summe der Dienste (von–bis abzüglich Pause)
 * Gutschrift = Urlaub, Krankenstand und Feiertag/Betriebsruhe: je Tag Wochenstunden / Arbeitstage pro Woche,
 *              höchstens so viele Tage pro Woche, bis (gearbeitete Tage + Gutschrifttage) = Arbeitstage pro Woche.
 * Ist      = gearbeitet + Gutschrift
 * Saldo    = Ist - Soll   (Plus-/Minusstunden)
 * Zeitausgleich (ZA) zählt als freier Tag ohne Gutschrift und baut damit Plusstunden ab.
 */

// Wie zählt ein freier, regulärer Arbeitstag? 'hol' = Feiertag/Betriebsruhe (Stundengutschrift, kein Urlaubsabzug),
// 'abs' = Abwesenheit (Urlaub, Krank, Zeitausgleich), '' = gewöhnlicher freier Tag.
// Gesetzliche Feiertage werden nie auf den Urlaub angerechnet; eine Betriebsruhe mit eingetragenem Urlaub schon.
function offDayKind(st, absType) {
  const closed = !!(st.closure || st.closedHoliday);
  if ((st.holiday && (absType || closed)) || (closed && !absType)) return 'hol';
  return absType ? 'abs' : '';
}

function empWindow(emp) {
  const track = emp.trackFrom ? toDn(emp.trackFrom) : NaN;
  const from = emp.from ? toDn(emp.from) : NaN;
  const to = emp.to ? toDn(emp.to) : NaN;
  let a = Math.max(isNaN(track) ? -1e9 : track, isNaN(from) ? -1e9 : from);
  if (a < -1e8) a = dnOf(ymd(todayDn()).y, 1, 1);
  return { a, b: isNaN(to) ? 1e9 : to };
}

// Tagesdatensätze einer Person für a..b (einschließlich). Die Wochenlogik läuft über ganze Kalenderwochen.
function empDayRecords(emp, a, b) {
  const S = state.settings, win = empWindow(emp);
  const abs = getIndex().abs.get(emp.id);
  const C = Math.max(1, +emp.days || 5);
  const dayH = (+emp.weekly || 0) / C;
  const off = emp.offDays || EMPTY;
  const out = [];
  for (let ws = mondayOf(a); ws <= b; ws += 7) {
    const wk = [];
    let W = 0;
    for (let k = 0; k < 7; k++) {
      const dn = ws + k;
      const inWin = dn >= win.a && dn <= win.b;
      const r = { dn, inWin, cat: '', work: 0, credit: 0, soll: 0, vac: 0, sick: 0, za: 0, hol: 0, entries: EMPTY, abs: null };
      if (inWin) {
        r.soll = (+emp.weekly || 0) / 7;
        const ens = entriesOf(emp.id, dn);
        r.entries = ens;
        if (ens.length) {
          for (const en of ens) r.work += entHours(en);
          r.cat = 'work';
          W++;
        }
      }
      wk.push(r);
    }
    // Tage ohne Dienst: freie Tage, Abwesenheiten und Feiertage einordnen
    const hol = [], ab = [];
    for (const r of wk) {
      if (!r.inWin || r.cat === 'work') continue;
      const wd = wdOf(r.dn);
      const st = dayStatus(r.dn);
      const absType = abs ? abs.get(r.dn) || null : null;
      r.abs = absType;
      if (!S.openDays[wd] || off.indexOf(wd) >= 0) { r.cat = !S.openDays[wd] ? 'ruhetag' : 'frei'; continue; }
      if (absType === 'frei') { r.cat = 'frei'; continue; } // fix freigehalten: wie ein normaler freier Tag
      const kind = offDayKind(st, absType);
      if (kind === 'hol') hol.push(r);
      else if (kind === 'abs') ab.push(r);
      else r.cat = 'frei';
    }
    let R = Math.max(0, C - W); // freie Kapazität dieser Woche
    for (const r of hol) {
      if (R > 0) { R--; r.cat = 'feiertag'; r.hol = 1; r.credit = dayH; } else r.cat = 'nocredit';
    }
    for (const r of ab) {
      if (R <= 0) { r.cat = 'nocount'; continue; }
      R--;
      if (r.abs === 'urlaub') { r.cat = 'urlaub'; r.vac = 1; r.credit = dayH; }
      else if (r.abs === 'krank') { r.cat = 'krank'; r.sick = 1; r.credit = dayH; }
      else { r.cat = 'za'; r.za = 1; }
    }
    for (const r of wk) if (r.dn >= a && r.dn <= b) out.push(r);
  }
  return out;
}

function sumRecords(recs) {
  const t = { soll: 0, work: 0, cVac: 0, cSick: 0, cHol: 0, vacDays: 0, sickDays: 0, zaDays: 0, holDays: 0, workDays: 0 };
  for (const r of recs) {
    if (!r.inWin) continue;
    t.soll += r.soll;
    t.work += r.work;
    if (r.cat === 'work') t.workDays++;
    if (r.vac) { t.vacDays++; t.cVac += r.credit; }
    if (r.sick) { t.sickDays++; t.cSick += r.credit; }
    if (r.za) t.zaDays++;
    if (r.hol) { t.holDays++; t.cHol += r.credit; }
  }
  t.credit = t.cVac + t.cSick + t.cHol;
  t.ist = t.work + t.credit;
  t.saldo = t.ist - t.soll;
  return t;
}
const empTotals = (emp, a, b) => sumRecords(empDayRecords(emp, a, b));

// Zeitkonto: Startsaldo + alle Monate seit Beginn der Zeitkonto-Führung bis upTo
function empAccount(emp, upTo) {
  const win = empWindow(emp);
  const start = +emp.balStart || 0;
  if (win.a > upTo) return { saldo: 0, konto: start };
  const t = empTotals(emp, win.a, Math.min(upTo, win.b));
  return { saldo: t.saldo, konto: start + t.saldo };
}

/* ---------- Urlaub ----------
 * Urlaubsjahr = ab dem Jahrestag des Eintritts (ohne Eintrittsdatum: Kalenderjahr). Am Jahrestag wird der Jahresanspruch
 * neu gutgeschrieben, ein nicht verbrauchter Rest wird übertragen. Im Urlaubsjahr des Austritts gilt der Anspruch
 * aliquot (Tage des Arbeitsverhältnisses im Urlaubsjahr / Tage des Urlaubsjahres).
 */
const daysInMonth = (y, m) => monthEnd(y, m) - monthStart(y, m) + 1;
function vacAnchor(emp) { // [Monat, Tag] des Eintritts
  const f = emp.from ? toDn(emp.from) : NaN;
  if (isNaN(f)) return [1, 1];
  const t = ymd(f);
  return [t.m, t.d];
}
function anniversary(emp, y) { // Jahrestag im Jahr y (29.2. -> 28.2. in Nicht-Schaltjahren)
  const [m, d] = vacAnchor(emp);
  return dnOf(y, m, Math.min(d, daysInMonth(y, m)));
}
function vacYearStart(emp, dn) {
  const s = anniversary(emp, ymd(dn).y);
  return s <= dn ? s : anniversary(emp, ymd(dn).y - 1);
}
const vacYearEnd = (emp, start) => anniversary(emp, ymd(start).y + 1) - 1;

// Resturlaub per Stichtag (der Stichtag ist der Tag vor trackFrom, die Werte gelten zum Ende dieses Tages).
// Ältere Daten ohne vacRest verwenden weiter Vorjahresrest und bereits genommenen Urlaub.
const hasVacRest = emp => emp.vacRest != null && emp.vacRest !== '' && !isNaN(+emp.vacRest);
function vacRestOf(emp) { // Resturlaub per Stichtag, auch für ältere Daten
  return hasVacRest(emp) ? +emp.vacRest : (+emp.vacCarry || 0) + (+emp.vac || 0) - (+emp.vacUsedBefore || 0);
}
// Zerlegt den Stand in "Übertrag ins erste Urlaubsjahr" und "davon schon genommen"
function vacStartParts(emp, ys0) {
  if (!hasVacRest(emp)) return { carry: +emp.vacCarry || 0, before: +emp.vacUsedBefore || 0 };
  const R = +emp.vacRest, ent = +emp.vac || 0;
  const track = emp.trackFrom ? toDn(emp.trackFrom) : NaN, from = emp.from ? toDn(emp.from) : NaN;
  if (!isNaN(track) && !isNaN(from) && track - 1 < from) return { carry: 0, before: 0 }; // Stand vor dem Eintritt: nichts zu übernehmen
  if (!isNaN(track) && vacYearStart(emp, track - 1) < ys0) return { carry: R, before: 0 }; // Stand am Ende des Vorjahres: Übertrag
  return R <= ent ? { carry: 0, before: ent - R } : { carry: R - ent, before: 0 };
}

// Urlaubsstand zum Tag upTo: Anspruch + Übertrag - genommen im Urlaubsjahr, das upTo enthält.
// Liegt upTo auf oder nach dem Austritt, wird aliquot bis zum Austritt abgerechnet (final = true).
function vacationInfo(emp, upTo) {
  const win = empWindow(emp);
  const ref = Math.min(upTo, win.b);
  if (ref < win.a) return null;
  const final = win.b < 1e8 && upTo >= win.b;
  let ys = vacYearStart(emp, win.a);
  const ys0 = ys, parts = vacStartParts(emp, ys0);
  let carry = parts.carry;
  for (let guard = 0; guard < 80; guard++) {
    const ye = vacYearEnd(emp, ys), before = ys === ys0 ? parts.before : 0;
    if (ref <= ye) return vacYear(emp, ys, ye, carry, upTo, before, final);
    carry = vacYear(emp, ys, ye, carry, ye, before, false).rest;
    ys = ye + 1;
  }
  return null;
}
function vacYear(emp, ys, ye, carry, upTo, before, final) {
  const win = empWindow(emp);
  const a = Math.max(ys, win.a), b = Math.min(ye, win.b);
  let usedProg = 0, later = 0;
  if (a <= b) {
    for (const r of empDayRecords(emp, a, b)) if (r.vac) { if (r.dn <= upTo) usedProg++; else later++; }
  }
  const full = +emp.vac || 0, daysInYear = ye - ys + 1, endDay = Math.min(ye, win.b);
  const daysWorked = endDay - ys + 1;
  const entitlement = final ? full * daysWorked / daysInYear : full;
  const used = before + usedProg;
  const rest = carry + entitlement - used;
  return { yStart: ys, yEnd: ye, entitlement, fullEntitlement: full, carry, used, before, usedProg, later, rest, restAfterPlanned: rest - later, final, daysWorked, daysInYear, endDay };
}
// Abrechnung, falls der Mitarbeiter am Tag `exit` ausscheidet (auch als Vorschau vor dem Speichern)
function vacationSettlement(emp, exit) {
  return vacationInfo(Object.assign({}, emp, { to: fromDn(exit) }), exit);
}

// Lücke zwischen Stichtag und heute: Soll-Stunden ohne eingetragene Dienste ergeben Minusstunden.
// stand = Stichtag (dn); gerechnet wird von stand+1 bis gestern. Liefert null, wenn es keine Lücke gibt.
function standGap(emp, stand, today) {
  const a = stand + 1, b = today - 1;
  if (isNaN(stand) || a > b) return null;
  const temp = Object.assign({}, emp, { trackFrom: fromDn(a), active: true });
  const t = empTotals(temp, a, b);
  return { days: b - a + 1, soll: t.soll, ist: t.ist, saldo: t.saldo };
}
