'use strict';
/* ===== Automatische Dienstplanung =====
 *
 * Eine Woche wird als Optimierungsproblem gelöst (Simulated Annealing):
 *  - jede Person hat pro Tag genau einen Dienst (Früh / Spät / Durchgehend ...) mit einer Position oder frei
 *  - hart bewertet: Mindestbesetzung je Position und Tageshälfte, Mindestanzahl Personen, Ruhezeit, Arbeitstage in Folge,
 *    Abwesenheiten, feste freie Tage, Positionen und erlaubte Dienste
 *  - weich bewertet: Wochenstunden (inkl. Urlaub/Krank-Gutschrift und bisherigem Zeitkonto), gleichmäßige Verteilung,
 *    zusammenhängende freie Tage, möglichst gleiche Dienstart, Hauptposition, faire Wochenenden
 * Manuell geänderte Dienste bleiben auf Wunsch unverändert; Tage außerhalb des Planungszeitraums werden nicht angefasst.
 */

const PW = { MISS: 1000, MINP: 900, REST: 400, CONSEC: 300, DAYS: 120, OVER: 11, UNDER: 8, LOST: 40, SPREAD: 0.35, OFFBLK: 1.5, KIND: 0.8, POSCHG: 0.5, ALT: 1.5, WKND: 0.8 };

function dayBounds(empId, dn) {
  const ens = entriesOf(empId, dn);
  if (!ens.length) return null;
  let s = Infinity, e = -Infinity;
  for (const x of ens) {
    const sp = shiftSpan(x.start, x.end);
    if (sp.s < s) s = sp.s;
    if (sp.e > e) e = sp.e;
  }
  return { s, e };
}

// Plant eine Kalenderwoche (ws = Montag). opt: { from, to, keepManual, seed, iters, restarts }
function planWeek(ws, opt) {
  opt = opt || {};
  const S = state.settings, idx = getIndex();
  const rnd = mulberry32(opt.seed != null ? opt.seed : (Math.random() * 4294967296) >>> 0);
  const keepManual = opt.keepManual !== false;
  const rangeA = opt.from != null ? opt.from : ws, rangeB = opt.to != null ? opt.to : ws + 6;
  const P = S.positions, nP = P.length;
  const posIndex = new Map(P.map((p, i) => [p.id, i]));
  const shIndex = new Map(S.shifts.map((s, i) => [s.id, i]));
  const shifts = S.shifts.filter(s => netHours(s.start, s.end, s.pause) > 0);
  const minRest = (+S.minRestH || 0) * 60, maxConsec = +S.maxConsec || 7;

  const OFF = { off: true, st: 0, en: 0, hrs: 0, cov: 0, parts: EMPTY, shIdx: -1, pos: -1, isMain: true };
  const makeOpt = (sh, posId, isMain) => {
    const { s, e } = shiftSpan(sh.start, sh.end);
    const cov = covMask(sh.covers), pos = posIndex.get(posId);
    return { off: false, sh, shIdx: shIndex.get(sh.id), pos, st: s, en: e, hrs: (e - s - (+sh.pause || 0)) / 60, cov, isMain, parts: [{ pos, cov }] };
  };
  const fixedOpt = entries => {
    let st = Infinity, en = -Infinity, hrs = 0, cov = 0;
    const parts = [];
    for (const x of entries) {
      const sp = shiftSpan(x.start, x.end), c = covMask(x.cov);
      st = Math.min(st, sp.s); en = Math.max(en, sp.e); hrs += (sp.e - sp.s - (+x.pause || 0)) / 60; cov |= c;
      parts.push({ pos: posIndex.has(x.pos) ? posIndex.get(x.pos) : -1, cov: c });
    }
    return { off: false, fixed: true, st, en, hrs, cov, parts, shIdx: -2, pos: parts[0].pos, isMain: true };
  };

  /* ---- Tage ---- */
  const days = [];
  for (let k = 0; k < 7; k++) {
    const dn = ws + k, st = dayStatus(dn);
    const req = P.map(p => { const r = (S.req[p.id] || [])[k] || [0, 0]; return st.open ? [r[0] | 0, r[1] | 0] : [0, 0]; });
    let tot = 0;
    req.forEach(r => { tot += r[0] + r[1]; });
    days.push({ dn, k, st, open: st.open && dn >= rangeA && dn <= rangeB, req, tot });
  }
  const openDays = days.filter(d => d.st.open);
  const avgTot = openDays.length ? openDays.reduce((s, d) => s + d.tot, 0) / openDays.length : 1;
  days.forEach(d => { d.w = Math.max(0.5, d.tot / Math.max(1, avgTot)); });

  /* ---- Personen ---- */
  const emps = state.employees.filter(e => {
    if (e.active === false || !e.main || !posIndex.has(e.main)) return false;
    const f = e.from ? toDn(e.from) : -1e9, t = e.to ? toDn(e.to) : 1e9;
    return f <= ws + 6 && t >= ws;
  });
  const empIds = new Set(emps.map(e => e.id));
  const nE = emps.length;
  let prevPlanned = false;
  for (let dn = ws - 7; dn < ws; dn++) if (dayEntries(dn).length) prevPlanned = true;

  const E = emps.map(e => {
    const eFrom = e.from ? toDn(e.from) : -1e9, eTo = e.to ? toDn(e.to) : 1e9;
    const C = Math.max(1, +e.days || 5), weekly = +e.weekly || 0, dayH = weekly / C;
    const off = e.offDays || EMPTY;
    const absMap = idx.abs.get(e.id);
    const win = empWindow(e);
    const avail = [], forced = [], tracked = [];
    let empDays = 0, candCredit = 0, candZa = 0;
    for (let k = 0; k < 7; k++) {
      const dn = ws + k, d = days[k];
      const employed = dn >= eFrom && dn <= eTo;
      const absType = absMap ? absMap.get(dn) || null : null;
      const isTracked = employed && dn >= win.a && dn <= win.b; // zählt für Soll
      tracked.push(isTracked);
      if (isTracked) empDays++;
      const regular = isTracked && S.openDays[k] && off.indexOf(k) < 0;
      if (regular && absType !== 'frei') {
        const kind = offDayKind(d.st, absType);
        if (kind === 'hol') candCredit++;
        else if (kind === 'abs') { if (absType === 'za') candZa++; else candCredit++; }
      }
      avail.push(d.st.open && employed && !absType && off.indexOf(k) < 0);
      forced.push(!avail[k]);
    }
    // Über-/Unterstunden der letzten 4 Wochen werden zur Hälfte in dieser Woche ausgeglichen
    // (nur wenn davor überhaupt geplant wurde, sonst würden Lücken im Plan als Minusstunden gelten)
    let carry = 0;
    if (prevPlanned && ws - 1 >= win.a) carry = clamp(empTotals(e, Math.max(win.a, ws - 28), ws - 1).saldo, -6, 6) * 0.5;
    const T = Math.max(0, weekly * empDays / 7 - dayH * candZa - carry);
    // Auswahl an möglichen Diensten
    const posList = [e.main].concat((e.alt || []).filter(x => x !== e.main)).filter(id => posIndex.has(id));
    const allowed = e.allowed && e.allowed.length ? shifts.filter(s => e.allowed.indexOf(s.id) >= 0) : shifts;
    const opts = [], optBy = new Map();
    for (const sh of allowed) for (const pid of posList) {
      const o = makeOpt(sh, pid, pid === e.main);
      opts.push(o);
      optBy.set(o.shIdx * 64 + o.pos, o);
    }
    // Umfeld: Tage vor und nach der Woche
    let run = 0;
    for (let dn = ws - 1; dn >= ws - 14 && entriesOf(e.id, dn).length; dn--) run++;
    const pb = dayBounds(e.id, ws - 1), nb = dayBounds(e.id, ws + 7);
    let wkPrior = 0;
    for (let dn = ws - 28; dn < ws; dn++) if (wdOf(dn) >= 5) wkPrior += entriesOf(e.id, dn).length ? 1 : 0;
    return { emp: e, C, dayH, T, target: T, tracked, candCredit, avail, forced, opts, optBy, run, prevEnd: pb ? pb.e : null, nextStart: nb ? nb.s : null, wkPrior, wkDelta: 0 };
  });
  if (S.fairWeekends !== false && nE) {
    const mean = E.reduce((s, e) => s + e.wkPrior, 0) / nE;
    E.forEach(e => { e.wkDelta = e.wkPrior - mean; });
  }

  /* ---- feste Zellen (außerhalb des Zeitraums / manuell) und Hintergrund ---- */
  const fixed = E.map(() => new Array(7).fill(null));
  E.forEach((e, ei) => {
    for (let k = 0; k < 7; k++) {
      const dn = ws + k, existing = entriesOf(e.emp.id, dn);
      const inRange = dn >= rangeA && dn <= rangeB;
      const keep = !inRange ? existing : keepManual ? existing.filter(x => x.manual) : EMPTY;
      if (keep.length) fixed[ei][k] = fixedOpt(keep);
      else if (!inRange) fixed[ei][k] = OFF;
    }
  });
  // Angebrochene Wochen (z. B. am Monatsende): bereits Eingetragenes zählt mit, der Rest wird nach Kalendertagen
  // (wie das Soll) auf die jetzt und die später noch zu planenden Tage verteilt
  E.forEach((e, ei) => {
    let hOut = 0, hFixIn = 0, calIn = 0, calAfter = 0;
    for (let k = 0; k < 7; k++) {
      const dn = ws + k, inRange = dn >= rangeA && dn <= rangeB, f = fixed[ei][k], has = !!(f && !f.off);
      if (has) { if (inRange) hFixIn += f.hrs; else hOut += f.hrs; }
      if (!e.tracked[k]) continue;
      if (inRange) calIn++;
      else if (dn > rangeB && !has && e.avail[k]) calAfter++;
    }
    const R = Math.max(0, e.T - hOut - hFixIn);
    e.target = Math.max(0, e.T - (calIn + calAfter > 0 ? R * calAfter / (calIn + calAfter) : 0));
  });
  const bgCnt = days.map(() => new Int32Array(nP * 2)), bgHead = days.map(() => 0);
  days.forEach(d => {
    const seen = new Set();
    for (const x of dayEntries(d.dn)) {
      if (empIds.has(x.emp)) continue;
      seen.add(x.emp);
      const c = covMask(x.cov), p = posIndex.get(x.pos);
      if (p === undefined) continue;
      if (c & 1) bgCnt[d.k][p * 2]++;
      if (c & 2) bgCnt[d.k][p * 2 + 1]++;
    }
    bgHead[d.k] = seen.size;
  });

  /* ---- freie Zellen ---- */
  const freeCells = [], freeDaysOf = E.map(() => []), freeEmpsOfDay = days.map(() => []);
  E.forEach((e, ei) => {
    if (!e.opts.length) return;
    for (let k = 0; k < 7; k++) {
      if (fixed[ei][k] || e.forced[k]) continue;
      freeCells.push(ei * 7 + k); freeDaysOf[ei].push(k); freeEmpsOfDay[k].push(ei);
    }
  });

  const cur = E.map((e, ei) => fixed[ei].map(f => f || OFF));
  const cnt = new Int32Array(nP * 2);
  const wkStress = S.fairWeekends !== false;

  function dayCost(k) {
    const d = days[k];
    if (!d.open) return 0;
    cnt.fill(0);
    let head = bgHead[k];
    for (let i = 0; i < nE; i++) {
      const o = cur[i][k];
      if (o.off) continue;
      head++;
      const parts = o.parts;
      for (let q = 0; q < parts.length; q++) {
        const pt = parts[q];
        if (pt.pos < 0) continue;
        if (pt.cov & 1) cnt[pt.pos * 2]++;
        if (pt.cov & 2) cnt[pt.pos * 2 + 1]++;
      }
    }
    let c = 0;
    const bg = bgCnt[k];
    for (let p = 0; p < nP; p++) for (let s = 0; s < 2; s++) {
      const have = cnt[p * 2 + s] + bg[p * 2 + s], need = d.req[p][s];
      if (have < need) c += PW.MISS * (need - have);
    }
    if (head < S.minPersons) c += PW.MINP * (S.minPersons - head);
    const hw = head / d.w;
    return c + PW.SPREAD * hw * hw;
  }

  function rowCost(ei) {
    const e = E[ei], row = cur[ei];
    let hrs = 0, W = 0, cost = 0, run = e.run, prev = null, prevEnd = e.prevEnd, blocks = 0, wasOff = false;
    for (let k = 0; k < 7; k++) {
      const o = row[k];
      if (o.off) {
        if (!wasOff) blocks++;
        wasOff = true; run = 0; prev = null; prevEnd = null;
        continue;
      }
      wasOff = false;
      W++; hrs += o.hrs;
      if (prevEnd !== null && 1440 + o.st - prevEnd < minRest) cost += PW.REST;
      run++;
      if (run > maxConsec) cost += PW.CONSEC;
      if (prev) {
        if (prev.shIdx !== o.shIdx) cost += PW.KIND;
        if (prev.pos !== o.pos) cost += PW.POSCHG;
      }
      if (!o.isMain) cost += PW.ALT;
      if (wkStress && k >= 5) cost += PW.WKND * e.wkDelta;
      prev = o; prevEnd = o.en;
    }
    if (prevEnd !== null && e.nextStart !== null && 1440 + e.nextStart - prevEnd < minRest) cost += PW.REST;
    const credited = Math.min(e.candCredit, Math.max(0, e.C - W));
    const dev = hrs + credited * e.dayH - e.target;
    cost += dev > 0 ? PW.OVER * dev : -PW.UNDER * dev;
    cost += PW.LOST * (e.candCredit - credited);
    if (W > e.C) cost += PW.DAYS * (W - e.C);
    if (blocks > 1) cost += PW.OFFBLK * (blocks - 1);
    return cost;
  }

  const rowC = new Array(nE), dayC = new Array(7);
  const cellCost = () => {
    let t = 0;
    for (let i = 0; i < nE; i++) t += (rowC[i] = rowCost(i));
    for (let k = 0; k < 7; k++) t += (dayC[k] = dayCost(k));
    return t;
  };

  let bestSol = null, bestTot = Infinity;
  if (freeCells.length) {
    const iters = opt.iters || Math.max(30000, freeCells.length * 1000);
    const restarts = opt.restarts || 3;
    const T0 = 25, T1 = 0.12, cool = Math.pow(T1 / T0, 1 / iters);
    for (let rs = 0; rs < restarts; rs++) {
      for (let i = 0; i < nE; i++) for (let k = 0; k < 7; k++) cur[i][k] = fixed[i][k] || OFF;
      let total = cellCost(), T = T0;
      for (let it = 0; it < iters; it++, T *= cool) {
        const r = rnd();
        if (r < 0.55) {
          // Zelle ändern
          const c = freeCells[(rnd() * freeCells.length) | 0], ei = (c / 7) | 0, k = c % 7;
          const e = E[ei], old = cur[ei][k];
          const nw = rnd() < 0.3 ? OFF : e.opts[(rnd() * e.opts.length) | 0];
          if (nw === old) continue;
          const oR = rowC[ei], oD = dayC[k];
          cur[ei][k] = nw;
          const nR = rowCost(ei), nD = dayCost(k), delta = nR + nD - oR - oD;
          if (delta <= 0 || rnd() < Math.exp(-delta / T)) { rowC[ei] = nR; dayC[k] = nD; total += delta; }
          else cur[ei][k] = old;
        } else if (r < 0.8) {
          // zwei Tage einer Person tauschen
          const c = freeCells[(rnd() * freeCells.length) | 0], ei = (c / 7) | 0, k1 = c % 7;
          const fd = freeDaysOf[ei], k2 = fd[(rnd() * fd.length) | 0];
          if (k1 === k2 || cur[ei][k1] === cur[ei][k2]) continue;
          const a = cur[ei][k1], b = cur[ei][k2];
          const oR = rowC[ei], oD1 = dayC[k1], oD2 = dayC[k2];
          cur[ei][k1] = b; cur[ei][k2] = a;
          const nR = rowCost(ei), nD1 = dayCost(k1), nD2 = dayCost(k2), delta = nR + nD1 + nD2 - oR - oD1 - oD2;
          if (delta <= 0 || rnd() < Math.exp(-delta / T)) { rowC[ei] = nR; dayC[k1] = nD1; dayC[k2] = nD2; total += delta; }
          else { cur[ei][k1] = a; cur[ei][k2] = b; }
        } else {
          // Dienste zweier Personen an einem Tag tauschen
          const c = freeCells[(rnd() * freeCells.length) | 0], e1 = (c / 7) | 0, k = c % 7;
          const fe = freeEmpsOfDay[k], e2 = fe[(rnd() * fe.length) | 0];
          if (e1 === e2) continue;
          const a = cur[e1][k], b = cur[e2][k];
          if (a === b) continue;
          const na = b.off ? OFF : E[e1].optBy.get(b.shIdx * 64 + b.pos);
          const nb = a.off ? OFF : E[e2].optBy.get(a.shIdx * 64 + a.pos);
          if (!na || !nb) continue;
          const o1 = rowC[e1], o2 = rowC[e2], oD = dayC[k];
          cur[e1][k] = na; cur[e2][k] = nb;
          const n1 = rowCost(e1), n2 = rowCost(e2), nD = dayCost(k), delta = n1 + n2 + nD - o1 - o2 - oD;
          if (delta <= 0 || rnd() < Math.exp(-delta / T)) { rowC[e1] = n1; rowC[e2] = n2; dayC[k] = nD; total += delta; }
          else { cur[e1][k] = a; cur[e2][k] = b; }
        }
      }
      // Feinschliff: Einzelverbesserungen, bis nichts mehr besser wird
      for (let pass = 0, improved = true; improved && pass < 6; pass++) {
        improved = false;
        for (const c of freeCells) {
          const ei = (c / 7) | 0, k = c % 7, e = E[ei], old = cur[ei][k];
          let bestO = old, bestD = 0;
          const oR = rowC[ei], oD = dayC[k];
          let bR = oR, bD = oD;
          for (let j = -1; j < e.opts.length; j++) {
            const o = j < 0 ? OFF : e.opts[j];
            if (o === old) continue;
            cur[ei][k] = o;
            const nR = rowCost(ei), nD = dayCost(k), delta = nR + nD - oR - oD;
            if (delta < bestD - 1e-9) { bestD = delta; bestO = o; bR = nR; bD = nD; }
          }
          cur[ei][k] = bestO;
          if (bestO !== old) { rowC[ei] = bR; dayC[k] = bD; total += bestD; improved = true; }
        }
      }
      if (total < bestTot - 1e-9) { bestTot = total; bestSol = cur.map(row => row.slice()); }
    }
  }

  /* ---- Ergebnis übernehmen ---- */
  for (let k = 0; k < 7; k++) {
    const dn = ws + k;
    if (dn < rangeA || dn > rangeB) continue;
    const iso = fromDn(dn);
    let arr = (state.plan[iso] || []).filter(en => !(empIds.has(en.emp) && !(keepManual && en.manual)));
    if (bestSol) {
      E.forEach((e, ei) => {
        const o = bestSol[ei][k];
        if (o.off || o.fixed) return;
        arr.push({ id: uid('n'), emp: e.emp.id, pos: P[o.pos].id, shift: o.sh.id, start: o.sh.start, end: o.sh.end, pause: +o.sh.pause || 0, cov: o.sh.covers, manual: false });
      });
    }
    if (arr.length) state.plan[iso] = arr; else delete state.plan[iso];
  }
  touch();
  return { cost: bestTot, employees: nE };
}

// Alle Wochen (Montage), die den Zeitraum a..b berühren
function weeksOf(a, b) {
  const out = [];
  for (let ws = mondayOf(a); ws <= b; ws += 7) out.push(ws);
  return out;
}

/* ===== Prüfung einer Woche (auch für manuell bearbeitete Pläne) ===== */

function checkWeek(ws) {
  const S = state.settings, out = [];
  const minRest = (+S.minRestH || 0) * 60, maxConsec = +S.maxConsec || 7;
  for (let k = 0; k < 7; k++) {
    const dn = ws + k, st = dayStatus(dn);
    if (!st.open) continue;
    const ens = dayEntries(dn);
    for (const p of S.positions) {
      const req = (S.req[p.id] || [])[k] || [0, 0];
      for (let s = 0; s < 2; s++) {
        const have = ens.filter(en => en.pos === p.id && (covMask(en.cov) & (1 << s))).length;
        if (have < req[s]) out.push({ type: 'cover', dn, pos: p.id, slot: s ? 'S' : 'F', need: req[s], have });
      }
    }
    const heads = new Set(ens.map(en => en.emp)).size;
    if (heads < S.minPersons) out.push({ type: 'minp', dn, have: heads, need: S.minPersons });
  }
  for (const e of state.employees) {
    let any = false;
    for (let k = -1; k < 7; k++) if (entriesOf(e.id, ws + k).length) any = true;
    if (!any && e.active === false) continue;
    // Ruhezeit und Arbeitstage in Folge
    let run = 0;
    for (let dn = ws - 14; dn <= ws + 6; dn++) if (dn >= ws - 14) {
      const b = dayBounds(e.id, dn);
      if (!b) { run = 0; continue; }
      run++;
      if (dn >= ws && run > maxConsec) out.push({ type: 'consec', emp: e.id, dn, run });
      const pb = dayBounds(e.id, dn - 1);
      if (dn >= ws && pb && 1440 + b.s - pb.e < minRest) out.push({ type: 'rest', emp: e.id, dn, rest: (1440 + b.s - pb.e) / 60 });
    }
    // Einträge an Abwesenheitstagen
    for (let k = 0; k < 7; k++) {
      const a = absenceOf(e.id, ws + k);
      if (a && (a === 'urlaub' || a === 'krank') && entriesOf(e.id, ws + k).length) out.push({ type: 'conflict', emp: e.id, dn: ws + k, abs: a });
    }
    // Wochenstunden
    if (e.active !== false && +e.weekly > 0) {
      const t = empTotals(e, ws, ws + 6);
      if (t.soll > 0 && Math.abs(t.saldo) >= 2) out.push({ type: 'hours', emp: e.id, saldo: t.saldo, ist: t.ist, soll: t.soll });
    }
  }
  return out;
}

function describeIssue(x) {
  const emp = x.emp ? (getEmp(x.emp) || {}).name : '';
  const day = x.dn != null ? WD_SHORT[wdOf(x.dn)] + ' ' + fmtDM(x.dn) : '';
  switch (x.type) {
    case 'cover': { const p = getPos(x.pos); return day + ': ' + (p ? p.name : '?') + ' ' + (x.slot === 'F' ? 'früh' : 'spät') + ' nicht ausreichend besetzt (' + x.have + ' von ' + x.need + ')'; }
    case 'minp': return day + ': nur ' + x.have + ' Person' + (x.have === 1 ? '' : 'en') + ' eingeteilt (mindestens ' + x.need + ')';
    case 'rest': return day + ': ' + emp + ' hat nur ' + fmtNum(x.rest, 1) + ' Std. Ruhezeit vor dem Dienst';
    case 'consec': return day + ': ' + emp + ' arbeitet den ' + x.run + '. Tag in Folge';
    case 'conflict': return day + ': ' + emp + ' ist eingeteilt, hat aber ' + (x.abs === 'krank' ? 'Krankenstand' : 'Urlaub');
    case 'hours': return emp + ': Woche ' + fmtSigned(x.saldo) + ' Std. (Ist ' + fmtH(x.ist) + ' / Soll ' + fmtH(x.soll) + ')';
  }
  return '';
}
