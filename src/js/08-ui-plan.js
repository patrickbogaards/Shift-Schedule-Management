'use strict';
/* ===== Oberfläche: Dienstplan (Wochenansicht) ===== */

function planEmployees(ws) {
  const order = new Map(state.settings.positions.map((p, i) => [p.id, i]));
  const list = state.employees.filter(e => {
    const f = e.from ? toDn(e.from) : -1e9, t = e.to ? toDn(e.to) : 1e9;
    if (e.active !== false && f <= ws + 6 && t >= ws) return true;
    for (let k = 0; k < 7; k++) if (entriesOf(e.id, ws + k).length) return true;
    return false;
  });
  const rank = e => (order.has(e.main) ? order.get(e.main) : 99);
  return list.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'de'));
}

function chipHtml(en, emp) {
  const p = getPos(en.pos), sh = getShift(en.shift);
  const color = p ? p.color : '#868e96';
  const label = en.shift === 'custom' || !sh ? 'Eigene Zeit' : sh.name;
  const other = p && en.pos !== emp.main ? ' · ' + p.name : '';
  const title = label + ' · ' + (p ? p.name : '?') + ' · ' + fmtH(entHours(en)) + ' Std. (Pause ' + (en.pause || 0) + ' Min.)' + (en.manual ? ' · manuell geändert' : '');
  return '<div class="chip' + (en.manual ? ' man' : '') + '" style="--pc:' + color + ';--pb:' + tint(color, 0.14) + '" title="' + esc(title) + '">' +
    '<div class="t">' + esc(en.start) + '–' + esc(en.end) + '</div><div class="s">' + esc(label + other) + '</div></div>';
}

function cellHtml(emp, dn, st) {
  const ens = entriesOf(emp.id, dn), abs = absenceOf(emp.id, dn);
  let inner = '';
  if (ens.length) inner = ens.slice().sort((a, b) => parseHM(a.start) - parseHM(b.start)).map(en => chipHtml(en, emp)).join('');
  else if (abs) inner = '<div class="absc a-' + abs + '">' + esc(ABS_TYPES[abs] || abs) + '</div>';
  const cls = ['cell'];
  if (!st.open) cls.push('closed');
  if (dn === todayDn()) cls.push('today');
  if (!inner) cls.push('empty');
  return '<td class="' + cls.join(' ') + '" data-act="cell" data-emp="' + emp.id + '" data-dn="' + dn + '">' + inner + '</td>';
}

function coverageHtml(ws) {
  const S = state.settings;
  let rows = '';
  for (const p of S.positions) {
    let tds = '';
    for (let k = 0; k < 7; k++) {
      const dn = ws + k;
      if (!dayStatus(dn).open) { tds += '<td class="cv na">–</td>'; continue; }
      const ens = dayEntries(dn), req = S.req[p.id][k];
      const pill = (slot, lbl) => {
        const have = ens.filter(en => en.pos === p.id && (covMask(en.cov) & (slot ? 2 : 1))).length;
        return '<span class="pill ' + (have >= req[slot] ? 'ok' : 'bad') + '">' + lbl + ' ' + have + '/' + req[slot] + '</span>';
      };
      tds += '<td class="cv">' + pill(0, 'F') + pill(1, 'S') + '</td>';
    }
    rows += '<tr><th><i class="pdot" style="background:' + p.color + '"></i>' + esc(p.name) + '</th>' + tds + '</tr>';
  }
  let tot = '';
  for (let k = 0; k < 7; k++) {
    const dn = ws + k;
    if (!dayStatus(dn).open) { tot += '<td class="cv na">–</td>'; continue; }
    const n = new Set(dayEntries(dn).map(en => en.emp)).size;
    tot += '<td class="cv"><span class="pill ' + (n >= S.minPersons ? 'ok' : 'bad') + '">' + n + ' Pers.</span></td>';
  }
  rows += '<tr class="tot"><th>Personen gesamt <small>(mind. ' + S.minPersons + ')</small></th>' + tot + '</tr>';
  let head = '';
  for (let k = 0; k < 7; k++) head += '<th>' + WD_SHORT[k] + ' ' + fmtDM(ws + k) + '</th>';
  return '<table class="cov"><thead><tr><th>Besetzung <small>F = Früh · S = Spät</small></th>' + head + '</tr></thead><tbody>' + rows + '</tbody></table>';
}

function hintsHtml(ws) {
  const issues = checkWeek(ws);
  const hard = issues.filter(i => i.type !== 'hours'), soft = issues.filter(i => i.type === 'hours');
  let html = '';
  const list = (arr, cls, icon) => {
    const shown = arr.slice(0, 14).map(i => '<li class="' + cls + '"><span>' + icon + '</span>' + esc(describeIssue(i)) + '</li>').join('');
    return shown + (arr.length > 14 ? '<li class="' + cls + '"><span>…</span>und ' + (arr.length - 14) + ' weitere</li>' : '');
  };
  if (hard.length) html += list(hard, 'bad', '⚠');
  if (soft.length) html += list(soft, 'warn', 'ℹ');
  if (!hard.length && !soft.length) {
    const any = Array.from({ length: 7 }, (_, k) => dayEntries(ws + k).length).some(Boolean);
    html = any ? '<li class="ok"><span>✓</span>Alles in Ordnung: Mindestbesetzung erfüllt, Ruhezeiten eingehalten, Wochenstunden passen.</li>'
      : '<li class="warn"><span>ℹ</span>Für diese Woche ist noch nichts geplant. „Automatisch planen“ erstellt den Plan.</li>';
  }
  return '<ul class="hints">' + html + '</ul>';
}

function emptyStateHtml() {
  return '<section class="card welcome"><h2>Willkommen im Dienstplan</h2>' +
    '<p>So kommen Sie in drei Schritten zum ersten Dienstplan:</p>' +
    '<ol><li><b>Mitarbeiter anlegen</b> mit Name, Anstellungsart, Wochenstunden, Urlaubsanspruch und Position.</li>' +
    '<li><b>Einstellungen prüfen</b>: Öffnungstage, Dienstzeiten (Früh, Spät, durchgehend) und Mindestbesetzung je Position.</li>' +
    '<li><b>„Automatisch planen“</b> erstellt den Dienstplan. Einzelne Dienste ändern Sie per Klick.</li></ol>' +
    '<div class="row-btns"><button class="btn primary" data-act="emp-new">Ersten Mitarbeiter anlegen</button>' +
    (fsApi.supported ? '<button class="btn" data-act="fs-connect">Vorhandenen Datenordner öffnen …</button>' : '') +
    '<label class="btn">Sicherung laden<input type="file" accept=".json,application/json" hidden data-chg="restore-file"></label></div>' +
    '<p class="tip">Neuer Computer? Den kopierten Datenordner oder eine Sicherungsdatei öffnen.</p></section>';
}

VIEWS.plan = function () {
  if (!state.employees.length) return emptyStateHtml();
  const ws = ui.ws, wk = isoWeek(ws), S = state.settings;
  const emps = planEmployees(ws);
  const days = Array.from({ length: 7 }, (_, k) => ({ dn: ws + k, st: dayStatus(ws + k) }));
  const title = 'KW ' + wk.week + ' · ' + fmtDM(ws) + ' – ' + fmtDate(ws + 6);
  let head = '<th class="c-emp">Mitarbeiter</th>';
  for (const d of days) {
    const tag = d.st.holiday ? '<span class="tag hol">' + esc(d.st.holiday) + '</span>' : '';
    const closed = !d.st.open ? '<span class="tag cls">' + esc(d.st.closedReason) + '</span>' : '';
    head += '<th class="dh' + (d.dn === todayDn() ? ' today' : '') + (!d.st.open ? ' closed' : '') + '"><span class="wd">' + WD_SHORT[d.st.wd] + '</span> <span class="dt">' + fmtDM(d.dn) + '</span>' + tag + closed + '</th>';
  }
  head += '<th class="c-wk">Woche<small>Ist / Soll Std.</small></th>';

  let body = '', lastGroup = null;
  const ncol = 9;
  for (const e of emps) {
    if (e.main !== lastGroup) {
      lastGroup = e.main;
      const p = getPos(e.main);
      body += '<tr class="grp"><td colspan="' + ncol + '">' + (p ? '<i class="pdot" style="background:' + p.color + '"></i>' + esc(p.name) : 'Ohne Position') + '</td></tr>';
    }
    const t = empTotals(e, ws, ws + 6);
    let row = '<th class="c-emp"><div class="en">' + esc(e.name) + (e.active === false ? ' <em>(inaktiv)</em>' : '') + '</div><div class="es">' + esc(e.type) + ' · ' + fmtNum(e.weekly, 1).replace(',0', '') + ' Std.</div></th>';
    for (const d of days) row += cellHtml(e, d.dn, d.st);
    row += '<td class="wk"><b>' + fmtNum(t.ist, 1) + '</b> / ' + fmtNum(t.soll, 1) + (t.soll > 0 ? '<small class="' + saldoClass(t.saldo) + '">' + fmtSigned(t.saldo) + '</small>' : '') + '</td>';
    body += '<tr>' + row + '</tr>';
  }

  const legend = S.shifts.map(s => '<span class="lg"><b>' + esc(s.name) + '</b> ' + esc(s.start) + '–' + esc(s.end) + (s.pause ? ' (Pause ' + s.pause + ' Min.)' : '') + '</span>').join('');
  const posLegend = S.positions.map(p => '<span class="lg"><i class="pdot" style="background:' + p.color + '"></i>' + esc(p.name) + '</span>').join('');

  return '<div class="toolbar no-print">' +
    '<div class="weeknav"><button class="btn icon" data-act="week-prev" aria-label="Vorherige Woche">◀</button>' +
    '<div class="weeklabel">' + esc(title) + '</div>' +
    '<button class="btn icon" data-act="week-next" aria-label="Nächste Woche">▶</button>' +
    '<button class="btn" data-act="week-today">Heute</button>' +
    '<input type="date" class="datejump" value="' + fromDn(ws) + '" data-chg="week-jump" aria-label="Zu Datum springen"></div>' +
    '<div class="tools"><button class="btn primary" data-act="plan-open">Automatisch planen …</button>' +
    '<button class="btn" data-act="week-clear">Woche leeren</button>' +
    '<button class="btn" data-act="print">Drucken / PDF</button></div></div>' +
    '<div class="print-title">' + esc(S.name) + ' · Dienstplan ' + esc(title) + '</div>' +
    '<section class="card planwrap"><table class="plan"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></section>' +
    '<div class="legend">' + posLegend + '<span class="sep">|</span>' + legend + '</div>' +
    '<div class="two"><section class="card"><h3>Besetzung dieser Woche</h3>' + coverageHtml(ws) + '</section>' +
    '<section class="card no-print"><h3>Hinweise</h3>' + hintsHtml(ws) + '<p class="tip">Ein Klick auf ein Feld ändert den Dienst. Manuell geänderte Dienste (Punkt am Feld) bleiben bei neuer Planung erhalten.</p></section></div>';
};

/* ---------- Navigation ---------- */
ACTIONS['week-prev'] = () => { ui.ws -= 7; render(); };
ACTIONS['week-next'] = () => { ui.ws += 7; render(); };
ACTIONS['week-today'] = () => { ui.ws = mondayOf(todayDn()); render(); };
CHANGE['week-jump'] = el => { const d = toDn(el.value); if (!isNaN(d)) { ui.ws = mondayOf(d); render(); } };
ACTIONS['week-clear'] = () => {
  const ws = ui.ws;
  confirmBox('Alle Dienste der Woche vom ' + fmtDate(ws) + ' bis ' + fmtDate(ws + 6) + ' löschen?', 'Woche leeren', () => {
    mutate(() => { for (let k = 0; k < 7; k++) delete state.plan[fromDn(ws + k)]; });
    toast('Woche geleert');
  }, true);
};

/* ---------- Dienst einer Person an einem Tag bearbeiten ---------- */

function entryRowHtml(emp, en) {
  const S = state.settings;
  const sh = en ? (en.shift === 'custom' ? null : getShift(en.shift)) : S.shifts[0];
  const start = en ? en.start : S.shifts[0].start, end = en ? en.end : S.shifts[0].end, pause = en ? en.pause : S.shifts[0].pause;
  const selShift = en ? (sh && sh.start === start && sh.end === end && (+sh.pause || 0) === (+pause || 0) ? sh.id : 'custom') : S.shifts[0].id;
  const pos = en ? en.pos : emp.main;
  return '<div class="erow"><select name="shift" data-chg="erow-shift" aria-label="Dienstart">' +
    S.shifts.map(s => opt(s.id, s.name, s.id === selShift)).join('') + opt('custom', 'Eigene Zeit', selShift === 'custom') + '</select>' +
    '<input type="time" name="start" value="' + esc(start) + '" data-chg="erow-time" aria-label="von">' +
    '<span class="dash">–</span>' +
    '<input type="time" name="end" value="' + esc(end) + '" data-chg="erow-time" aria-label="bis">' +
    '<label class="pz">Pause <input type="number" name="pause" min="0" max="600" step="5" value="' + (+pause || 0) + '" data-chg="erow-time"> Min.</label>' +
    '<select name="pos" aria-label="Position">' + S.positions.map(p => opt(p.id, p.name, p.id === pos)).join('') + '</select>' +
    '<button type="button" class="icon-btn" data-act="erow-del" aria-label="Dienst entfernen">✕</button></div>';
}
CHANGE['erow-shift'] = el => {
  const row = el.closest('.erow'), sh = getShift(el.value);
  if (!sh) return;
  row.querySelector('[name=start]').value = sh.start;
  row.querySelector('[name=end]').value = sh.end;
  row.querySelector('[name=pause]').value = sh.pause || 0;
};
CHANGE['erow-time'] = el => {
  const row = el.closest('.erow'), sel = row.querySelector('[name=shift]'), sh = getShift(sel.value);
  if (!sh) return;
  const same = row.querySelector('[name=start]').value === sh.start && row.querySelector('[name=end]').value === sh.end && (+row.querySelector('[name=pause]').value || 0) === (+sh.pause || 0);
  if (!same) sel.value = 'custom';
};
ACTIONS['erow-del'] = el => { el.closest('.erow').remove(); };
ACTIONS['erow-add'] = el => {
  const form = el.closest('form');
  const emp = getEmp(form.dataset.emp);
  $('.erows', form).insertAdjacentHTML('beforeend', entryRowHtml(emp, null));
};

ACTIONS.cell = el => openCellEditor(el.dataset.emp, +el.dataset.dn);

function openCellEditor(empId, dn) {
  const emp = getEmp(empId);
  if (!emp) return;
  const ens = entriesOf(empId, dn).slice().sort((a, b) => parseHM(a.start) - parseHM(b.start));
  const abs = absenceOf(empId, dn), st = dayStatus(dn);
  const mode = ens.length ? 'dienst' : abs || 'leer';
  const radio = (v, label) => '<label class="segbtn"><input type="radio" name="mode" value="' + v + '"' + (mode === v ? ' checked' : '') + '><span>' + label + '</span></label>';
  const body =
    (st.closedReason ? '<p class="note warn">Das Restaurant ist an diesem Tag geschlossen (' + esc(st.closedReason) + ').</p>' : '') +
    '<div class="seg" role="radiogroup" aria-label="Status">' + radio('dienst', 'Dienst') + radio('leer', 'Kein Dienst') + radio('frei', 'Frei (fix)') + radio('urlaub', 'Urlaub') + radio('krank', 'Krank') + radio('za', 'Zeitausgleich') + '</div>' +
    '<div class="mode mode-dienst"><div class="erows">' + (ens.length ? ens.map(en => entryRowHtml(emp, en)).join('') : entryRowHtml(emp, null)) + '</div>' +
    '<button type="button" class="btn sm" data-act="erow-add">+ Weiteren Dienst an diesem Tag</button></div>' +
    '<p class="note mode mode-leer">Für diesen Tag ist kein Dienst eingetragen. Bei der nächsten automatischen Planung kann hier wieder ein Dienst eingeteilt werden.</p>' +
    '<p class="note mode mode-frei">Der Tag wird fest freigehalten. Die automatische Planung teilt hier keinen Dienst ein, es wird kein Urlaub abgezogen.</p>' +
    '<p class="note mode mode-abs">Wird für diesen einen Tag als Abwesenheit eingetragen. Längere Zeiträume: Registerkarte „Abwesenheiten“.</p>';
  openModal({
    title: emp.name + ' · ' + WD_LONG[wdOf(dn)] + ', ' + fmtDate(dn), body, noFocus: true,
    onMount: form => {
      form.dataset.emp = empId;
      const sync = () => {
        const m = form.mode.value;
        $$('.mode', form).forEach(x => { x.hidden = !(x.classList.contains('mode-' + m) || (x.classList.contains('mode-abs') && (m === 'urlaub' || m === 'krank' || m === 'za'))); });
      };
      $$('input[name=mode]', form).forEach(r => r.addEventListener('change', sync));
      sync();
    },
    onSubmit: form => {
      const m = form.mode.value;
      if (m === 'dienst') {
        const rows = [];
        for (const r of $$('.erow', form)) {
          const start = r.querySelector('[name=start]').value, end = r.querySelector('[name=end]').value;
          const pause = Math.max(0, +r.querySelector('[name=pause]').value || 0);
          if (isNaN(parseHM(start)) || isNaN(parseHM(end)) || start === end) { toast('Bitte Beginn und Ende des Dienstes eintragen.', 'bad'); return false; }
          const tpl = getShift(r.querySelector('[name=shift]').value);
          const same = tpl && tpl.start === start && tpl.end === end && (+tpl.pause || 0) === pause;
          rows.push({ pos: r.querySelector('[name=pos]').value, sh: same ? tpl : { id: 'custom', start, end, pause } });
        }
        if (!rows.length) { toast('Bitte mindestens einen Dienst eintragen oder „Kein Dienst“ wählen.', 'bad'); return false; }
        mutate(() => {
          removeEntriesOf(empId, dn, dn);
          setAbsenceDay(empId, dn, null);
          rows.forEach(r => addEntry(dn, makeEntry(empId, r.pos, r.sh, true)));
        });
      } else {
        mutate(() => {
          removeEntriesOf(empId, dn, dn);
          setAbsenceDay(empId, dn, m === 'leer' ? null : m);
        });
      }
    },
  });
}

/* ---------- Automatisch planen ---------- */

function planPreset(p) {
  const t = todayDn(), ws = ui.ws;
  const startOf = base => (t >= base && t <= base + 6 ? t : base);
  if (p === 'week') return [startOf(ws), ws + 6];
  if (p === 'weeks4') return [startOf(ws), ws + 27];
  const c = ymd(ws + 3), ms = monthStart(c.y, c.m), me = monthEnd(c.y, c.m);
  return [t >= ms && t <= me ? t : ms, me];
}
ACTIONS['plan-open'] = () => {
  const [from, to] = planPreset('week');
  openModal({
    title: 'Automatisch planen', submitLabel: 'Plan erstellen', noFocus: true,
    body: '<p class="lead">Der Plan wird aus Mindestbesetzung je Position, Wochenstunden, Urlaub, freien Tagen und Ruhezeiten erstellt. Danach lassen sich einzelne Dienste per Klick ändern.</p>' +
      '<div class="row2"><label>Von<input type="date" name="from" value="' + fromDn(from) + '" data-chg="plan-range"></label><label>Bis<input type="date" name="to" value="' + fromDn(to) + '" data-chg="plan-range"></label></div>' +
      '<div class="presets"><button type="button" class="btn sm" data-act="plan-preset" data-p="week">Angezeigte Woche</button>' +
      '<button type="button" class="btn sm" data-act="plan-preset" data-p="weeks4">4 Wochen</button>' +
      '<button type="button" class="btn sm" data-act="plan-preset" data-p="month">Ganzer Monat</button></div>' +
      '<label class="chk"><input type="checkbox" name="keep" checked> Manuell geänderte Dienste beibehalten</label>' +
      '<p class="note warn" id="planwarn" hidden>Der Zeitraum enthält vergangene Tage. Bereits eingetragene Dienste dort werden überschrieben (außer manuell geänderte).</p>',
    onMount: form => { CHANGE['plan-range'](form.from); },
    onSubmit: form => {
      const from = toDn(form.from.value), to = toDn(form.to.value);
      if (isNaN(from) || isNaN(to) || to < from) { toast('Bitte einen gültigen Zeitraum wählen.', 'bad'); return false; }
      if (to - from > 400) { toast('Der Zeitraum ist zu lang (höchstens etwa 13 Monate).', 'bad'); return false; }
      const keep = form.keep.checked;
      setTimeout(() => runPlan(from, to, keep), 30);
    },
  });
};
ACTIONS['plan-preset'] = el => {
  const form = el.closest('form'), [from, to] = planPreset(el.dataset.p);
  form.from.value = fromDn(from); form.to.value = fromDn(to);
  CHANGE['plan-range'](form.from);
};
CHANGE['plan-range'] = el => {
  const form = el.closest('form'), w = $('#planwarn', form), f = toDn(form.from.value);
  if (w) w.hidden = !(f < todayDn());
};

async function runPlan(from, to, keepManual) {
  const weeks = weeksOf(from, to);
  pushUndo();
  showBusy('Dienstplan wird erstellt …');
  await nextTick();
  try {
    for (let i = 0; i < weeks.length; i++) {
      $('.busy-msg', $('#busy')).textContent = weeks.length > 1 ? 'Woche ' + (i + 1) + ' von ' + weeks.length + ' wird geplant …' : 'Dienstplan wird erstellt …';
      await nextTick();
      planWeek(weeks[i], { from, to, keepManual });
    }
  } catch (e) {
    console.error(e);
    hideBusy();
    toast('Beim Planen ist ein Fehler aufgetreten: ' + e.message, 'bad');
    return;
  }
  hideBusy();
  if (ui.ws < mondayOf(from) || ui.ws > to) ui.ws = mondayOf(from);
  afterChange();
  let cover = 0, other = 0;
  for (const ws of weeks) for (const i of checkWeek(ws)) {
    if (i.dn == null || i.dn < from || i.dn > to) continue; // nur der geplante Zeitraum
    if (i.type === 'cover' || i.type === 'minp') cover++; else other++;
  }
  if (cover || other) toast('Plan erstellt, aber mit ' + (cover + other) + ' Hinweis(en): Personal reicht nicht für alle Vorgaben. Siehe „Hinweise“.', 'bad');
  else toast(weeks.length > 1 ? weeks.length + ' Wochen geplant. Alle Vorgaben erfüllt.' : 'Woche geplant. Alle Vorgaben erfüllt.');
}
