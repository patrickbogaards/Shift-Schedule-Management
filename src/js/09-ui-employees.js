'use strict';
/* ===== Oberfläche: Mitarbeiter ===== */

// Monatswerte einer Person (auch für die Auswertung genutzt)
function monthStats(emp, y, m) {
  const a = monthStart(y, m), b = monthEnd(y, m), win = empWindow(emp);
  const recs = empDayRecords(emp, a, b);
  return { recs, t: sumRecords(recs), acc: empAccount(emp, b), vac: vacationInfo(emp, b), active: win.a <= b && win.b >= a };
}
function monthNavHtml() {
  return '<div class="monthnav"><button class="btn icon" data-act="month-prev" aria-label="Vorheriger Monat">◀</button>' +
    '<div class="monthlabel">' + MONTHS[ui.month.m - 1] + ' ' + ui.month.y + '</div>' +
    '<button class="btn icon" data-act="month-next" aria-label="Nächster Monat">▶</button>' +
    '<button class="btn" data-act="month-today">Aktueller Monat</button></div>';
}
ACTIONS['month-prev'] = () => { if (--ui.month.m < 1) { ui.month.m = 12; ui.month.y--; } render(); };
ACTIONS['month-next'] = () => { if (++ui.month.m > 12) { ui.month.m = 1; ui.month.y++; } render(); };
ACTIONS['month-today'] = () => { const t = ymd(todayDn()); ui.month = { y: t.y, m: t.m }; render(); };

// ausgeschieden: manuell so markiert oder das Austrittsdatum liegt in der Vergangenheit
const isInactive = e => e.active === false || !!(e.to && toDn(e.to) < todayDn());

function empPositions(e) {
  return [e.main].concat(e.alt || []).filter((id, i, a) => id && a.indexOf(id) === i).map(getPos).filter(Boolean);
}

VIEWS.emp = function () {
  const { y, m } = ui.month;
  const rowHtml = e => {
    const s = monthStats(e, y, m);
    const pos = empPositions(e).map(p => '<span class="ptag"><i class="pdot" style="background:' + p.color + '"></i>' + esc(p.name) + '</span>').join('');
    let cells;
    if (!s.active) cells = '<td colspan="5" class="muted c">nicht im Zeitkonto dieses Monats</td>';
    else {
      const v = s.vac;
      const rest = v ? '<b title="Urlaubsjahr ' + fmtDate(v.yStart) + ' – ' + fmtDate(v.yEnd) + '">' + (v.final ? fmtDaysExact(v.rest) : fmtDays(v.rest)) + '</b> <small>von ' + (v.final ? fmtDaysExact(v.entitlement + v.carry) : fmtDays(v.entitlement + v.carry)) + '</small>' +
        (v.final ? '<small class="muted"> (Abrechnung zum Austritt)</small>' : v.later ? '<small class="muted"> (' + fmtDays(v.later) + ' danach geplant)</small>' : '') : '–';
      cells = '<td class="r">' + fmtH(s.t.ist) + '</td><td class="r">' + fmtH(s.t.soll) + '</td>' +
        '<td class="r ' + saldoClass(s.t.saldo) + '"><b>' + fmtSigned(s.t.saldo) + '</b></td>' +
        '<td class="r ' + saldoClass(s.acc.konto) + '"><b>' + fmtSigned(s.acc.konto) + '</b></td><td class="r">' + rest + '</td>';
    }
    return '<tr class="click" data-act="emp-edit" data-id="' + e.id + '"><td><b>' + esc(e.name) + '</b></td><td>' + esc(e.type) + '</td><td class="r">' + fmtNum(e.weekly, 1).replace(',0', '') + '</td><td>' + pos + '</td>' + cells + '</tr>';
  };
  const act = state.employees.filter(e => !isInactive(e)), inact = state.employees.filter(isInactive);
  const head = '<thead><tr><th>Name</th><th>Anstellungsart</th><th class="r">Std./Woche</th><th>Positionen</th><th class="r">Ist (Std.)</th><th class="r">Soll (Std.)</th><th class="r">Plus/Minus</th><th class="r">Zeitkonto gesamt</th><th class="r">Resturlaub (Tage)</th></tr></thead>';
  return '<div class="toolbar no-print">' + monthNavHtml() + '<div class="tools"><button class="btn" data-act="stand-open">Stände &amp; Eintritt übernehmen …</button><button class="btn primary" data-act="emp-new">+ Mitarbeiter</button></div></div>' +
    (state.employees.length ? '<section class="card"><h3>Mitarbeiter</h3><div class="tablewrap"><table class="list">' + head + '<tbody>' + act.map(rowHtml).join('') + '</tbody></table></div>' +
      '<p class="tip">Ist, Soll, Plus/Minus und Resturlaub werden automatisch aus dem Dienstplan errechnet. Ein Klick auf eine Zeile öffnet die Stammdaten; dort lässt sich ein Mitarbeiter auch als „Ausgeschieden“ markieren (Auswertungen bleiben erhalten) oder endgültig löschen. Eintrittsdatum, Resturlaub und Plus-/Minusstunden bestehender Mitarbeiter werden über „Stände &amp; Eintritt übernehmen …“ (alle auf einmal) oder in den Stammdaten eingetragen.</p></section>' +
      (inact.length ? '<section class="card"><h3>Ausgeschieden / inaktiv</h3><div class="tablewrap"><table class="list">' + head + '<tbody>' + inact.map(rowHtml).join('') + '</tbody></table></div></section>' : '')
      : emptyStateHtml());
};

/* ---------- Stammdaten bearbeiten ---------- */

ACTIONS['emp-new'] = () => openEmpEditor(null);
ACTIONS['emp-edit'] = el => openEmpEditor(el.dataset.id);
// Neue Mitarbeiter: Resturlaub folgt dem Anspruch, solange er nicht von Hand geändert wurde
function syncVacRest(form, newVac) {
  if (form.dataset.isnew !== '1') return;
  const r = form.elements.vacRest;
  if (+r.value === +form.dataset.vac) r.value = newVac;
  form.dataset.vac = newVac;
}
// Mitarbeiter-Objekt aus den (noch nicht gespeicherten) Formularwerten, für Vorschau und Hinweise
function formEmp(form) {
  const base = getEmp(form.dataset.emp) || newEmployee('Vollzeit', { id: form.dataset.emp });
  const stand = toDn(form.elements.standDate.value), E = form.elements;
  return Object.assign({}, base, {
    weekly: +E.weekly.value || 0, days: Math.round(+E.days.value) || 5, vac: +E.vac.value || 0,
    offDays: $$('input[name=off]:checked', form).map(x => +x.value), from: E.from.value, to: E.to.value,
    trackFrom: isNaN(stand) ? base.trackFrom : fromDn(stand + 1),
    vacRest: E.vacRest.value === '' ? null : +E.vacRest.value, balStart: +E.balStart.value || 0, vacCarry: 0, vacUsedBefore: 0,
  });
}
// Urlaubsabrechnung beim Austritt als Text
function settlementHtml(v, exitDn) {
  const rest = v.rest;
  const verdict = rest > 0.004 ? '<b class="plus">' + fmtDaysExact(rest) + ' Tage Urlaub sind bei Austritt noch offen (Urlaubsersatzleistung).</b>'
    : rest < -0.004 ? '<b class="minus">' + fmtDaysExact(-rest) + ' Tage mehr Urlaub genommen, als bis zum Austritt zustehen.</b>' : '<b>Der Urlaub ist genau aufgebraucht.</b>';
  return '<b>Urlaubsabrechnung zum Austritt am ' + fmtDate(exitDn) + '</b><br>Urlaubsjahr ' + fmtDate(v.yStart) + ' bis ' + fmtDate(v.yEnd) + ': Jahresanspruch ' + fmtDays(v.fullEntitlement) +
    ' Tage, aliquot für ' + v.daysWorked + ' von ' + v.daysInYear + ' Tagen = <b>' + fmtDaysExact(v.entitlement) + ' Tage</b>' + (v.carry ? ' · Übertrag aus früheren Urlaubsjahren ' + fmtDaysExact(v.carry) + ' Tage' : '') +
    ' · genommen ' + fmtDaysExact(v.used) + ' Tage<br>' + verdict + ' <span class="muted">Rundung und rechtliche Prüfung bitte mit der Lohnverrechnung abstimmen.</span>';
}
// Warnungen im Formular: Lücke seit dem Stand, Urlaubsabrechnung bei eingetragenem Austritt
function updateHints(form) {
  const emp = formEmp(form), stand = toDn(form.elements.standDate.value);
  const hint = form.querySelector('#standHint'), box = form.querySelector('#exitBox');
  if (hint) {
    const g = standGap(emp, stand, todayDn());
    if (!g || g.saldo > -4) hint.hidden = true;
    else {
      hint.hidden = false;
      hint.innerHTML = '<b>Achtung:</b> Zwischen dem Stand (' + fmtDate(stand) + ') und gestern liegen ' + g.days + ' Tage. Dafür rechnet das Programm ' + fmtH(g.soll) + ' Std. Soll, eingetragen sind aber nur ' + fmtH(g.ist) + ' Std. Das ergibt ' + fmtSigned(g.saldo) + ' Std. Besser: den Stand auf den Tag vor dem ersten Programmtag legen oder die bisherigen Dienste im Dienstplan nachtragen.';
    }
  }
  if (box) {
    const ex = toDn(form.elements.to.value), v = isNaN(ex) ? null : vacationSettlement(emp, ex);
    box.hidden = !form.elements.to.value;
    if (!box.hidden) box.innerHTML = v ? settlementHtml(v, ex) : 'Für das Austrittsdatum ist noch keine Urlaubsberechnung möglich (Eintritt bzw. Stand prüfen).';
  }
}
function standPreview(e) {
  const t = todayDn(), win = empWindow(e);
  if (win.a > t) return 'Das Programm beginnt am ' + fmtDate(win.a) + ' zu zählen.';
  const acc = empAccount(e, t), vi = vacationInfo(e, t);
  let s = '<b>Aktuell laut Programm (heute):</b> Resturlaub ' + (vi ? (vi.final ? fmtDaysExact(vi.rest) : fmtDays(vi.rest)) : '–') + ' Tage · Zeitkonto ' + fmtSigned(acc.konto) + ' Std.';
  if (vi && !vi.final) {
    const next = vi.yEnd + 1;
    if (next <= win.b) s += '<br>Nächste Gutschrift: +' + fmtDays(e.vac) + ' Tage am ' + fmtDate(next) + ' (Jahrestag des Eintritts).';
  }
  return s;
}
CHANGE['emp-type'] = el => {
  const form = el.closest('form');
  if (form.dataset.isnew !== '1') return;
  const t = EMP_TYPES[el.value];
  if (!t) return;
  syncVacRest(form, 5 * t.days);
  form.weekly.value = t.weekly; form.days.value = t.days; form.vac.value = 5 * t.days;
  form.dataset.days = t.days;
  updateHints(form);
};
CHANGE['emp-days'] = el => {
  const form = el.closest('form');
  if (+form.vac.value === 5 * (+form.dataset.days || 5)) { const nv = 5 * (+el.value || 5); syncVacRest(form, nv); form.vac.value = nv; }
  form.dataset.days = el.value;
  updateHints(form);
};
CHANGE['emp-vac'] = el => { const form = el.closest('form'); syncVacRest(form, +el.value || 0); updateHints(form); };
CHANGE['emp-stand'] = el => updateHints(el.closest('form'));

function openEmpEditor(id) {
  const S = state.settings;
  if (!S.positions.length) { toast('Bitte zuerst in den Einstellungen mindestens eine Position anlegen.', 'bad'); return; }
  const isNew = !id;
  const e = isNew ? newEmployee('Vollzeit', { main: S.positions[0].id }) : getEmp(id);
  if (!e) return;
  const chk = (name, val, label, on) => '<label class="chk sm"><input type="checkbox" name="' + name + '" value="' + esc(val) + '"' + (on ? ' checked' : '') + '>' + esc(label) + '</label>';
  const num = (name, val, extra) => '<input type="number" name="' + name + '" value="' + esc(val) + '" ' + (extra || '') + '>';
  const body =
    '<div class="grid2">' +
    '<label class="fld full">Name<input type="text" name="name" value="' + esc(e.name) + '" placeholder="Vor- und Nachname" required></label>' +
    '<label class="fld">Anstellungsart<select name="type" data-chg="emp-type">' + Object.keys(EMP_TYPES).map(t => opt(t, t, e.type === t)).join('') + '</select></label>' +
    '<label class="fld">Eintrittsdatum<input type="date" name="from" value="' + esc(e.from) + '" data-chg="emp-stand" required><small>Am Jahrestag des Eintritts kommen jedes Jahr neu die Urlaubstage dazu.</small></label>' +
    '<label class="fld">Normalarbeitszeit (Std. pro Woche)' + num('weekly', e.weekly, 'min="0" max="80" step="0.5" data-chg="emp-stand"') + '</label>' +
    '<label class="fld">Arbeitstage pro Woche' + num('days', e.days, 'min="1" max="7" step="1" data-chg="emp-days"') + '</label>' +
    '<label class="fld">Urlaubsanspruch (Tage pro Urlaubsjahr)' + num('vac', e.vac, 'min="0" max="60" step="0.5" data-chg="emp-vac"') + '<small>Wird jährlich zum Jahrestag des Eintritts gutgeschrieben (5 Wochen: bei 5 Arbeitstagen 25 Tage).</small></label>' +
    '<label class="fld">Austrittsdatum (nur beim Ausscheiden)<input type="date" name="to" value="' + esc(e.to) + '" data-chg="emp-stand"><small>Der Urlaub wird bis zu diesem Tag aliquot abgerechnet.</small></label>' +
    '</div><div class="note" id="exitBox" hidden></div>' +
    '<h4>Einsatz</h4><div class="grid2">' +
    '<label class="fld">Hauptposition<select name="main">' + S.positions.map(p => opt(p.id, p.name, e.main === p.id)).join('') + '</select></label>' +
    '<div class="fld">Kann auch arbeiten als<div class="chks">' + S.positions.map(p => chk('alt', p.id, p.name, (e.alt || []).indexOf(p.id) >= 0)).join('') + '</div></div>' +
    '<div class="fld">Erlaubte Dienste<div class="chks">' + S.shifts.map(s => chk('allowed', s.id, s.name + ' ' + s.start + '–' + s.end, !e.allowed || e.allowed.indexOf(s.id) >= 0)).join('') + '</div></div>' +
    '<div class="fld">Fix frei an (z. B. Schule, Zweitjob)<div class="chks">' + WD_SHORT.map((d, k) => chk('off', k, d, (e.offDays || []).indexOf(k) >= 0)).join('') + '</div></div>' +
    '</div>' +
    '<h4>Übernahme bisheriger Stände</h4>' +
    '<p class="muted">Bei bestehenden Mitarbeitern hier den Stand laut bisheriger Aufzeichnung (z. B. letzte Lohnabrechnung) mit Datum eintragen. Ab dem Tag danach rechnet das Programm weiter. Die Werte lassen sich jederzeit ändern.</p>' +
    '<div class="grid2">' +
    '<label class="fld">Stand per (Datum)<input type="date" name="standDate" value="' + fromDn(toDn(e.trackFrom) - 1) + '" data-chg="emp-stand" required><small>Die beiden Werte unten gelten am Ende dieses Tages.</small></label><div></div>' +
    '<label class="fld">Resturlaub per Stand (Tage)' + num('vacRest', vacRestOf(e), 'step="0.5"') + '<small>Alles, was der Mitarbeiter zu diesem Datum noch zugute hat (auch Rest aus dem Vorjahr).</small></label>' +
    '<label class="fld">Plus- oder Minusstunden per Stand (Std.)' + num('balStart', e.balStart, 'step="0.25"') + '<small>Plusstunden positiv, Minusstunden negativ, z. B. -6,5</small></label>' +
    '</div><p class="note warn" id="standHint" hidden></p>' + (isNew ? '' : '<p class="note" id="standNow">' + standPreview(e) + '</p>') +
    '<label class="fld full">Notiz<input type="text" name="note" value="' + esc(e.note) + '"></label>';
  let extra = '';
  if (!isNew) extra = '<button type="button" class="btn danger ghost" data-act="emp-delete" data-id="' + e.id + '">Löschen</button>' +
    (e.active === false ? '<button type="button" class="btn" data-act="emp-reactivate" data-id="' + e.id + '">Wieder aktivieren</button>' : '<button type="button" class="btn" data-act="emp-deactivate" data-id="' + e.id + '">Austritt erfassen …</button>');
  openModal({
    title: isNew ? 'Neuer Mitarbeiter' : e.name, body, extraHtml: extra, wide: true,
    onMount: form => { form.dataset.isnew = isNew ? '1' : '0'; form.dataset.days = e.days; form.dataset.vac = e.vac; form.dataset.emp = e.id; updateHints(form); },
    onSubmit: form => {
      const v = n => form.elements[n].value;
      const name = v('name').trim();
      if (!name) { toast('Bitte einen Namen eintragen.', 'bad'); form.elements.name.focus(); return false; }
      const weekly = +v('weekly'), days = Math.round(+v('days'));
      if (!(weekly >= 0 && weekly <= 80)) { toast('Die Wochenstunden müssen zwischen 0 und 80 liegen.', 'bad'); return false; }
      if (!(days >= 1 && days <= 7)) { toast('Die Arbeitstage pro Woche müssen zwischen 1 und 7 liegen.', 'bad'); return false; }
      if (!v('from')) { toast('Bitte das Eintrittsdatum angeben. Es bestimmt, wann jährlich neuer Urlaub hinzukommt.', 'bad'); form.elements.from.focus(); return false; }
      if (v('to') && v('to') < v('from')) { toast('Der Austritt liegt vor dem Eintritt.', 'bad'); return false; }
      const stand = toDn(v('standDate'));
      if (isNaN(stand)) { toast('Bitte das Datum angeben, für das Resturlaub und Plus-/Minusstunden gelten (Stand per).', 'bad'); form.elements.standDate.focus(); return false; }
      if (v('vacRest') === '' || isNaN(+v('vacRest'))) { toast('Bitte den Resturlaub per Stand eintragen (0 ist erlaubt).', 'bad'); form.elements.vacRest.focus(); return false; }
      const allowed = $$('input[name=allowed]:checked', form).map(x => x.value);
      if (!allowed.length) { toast('Mindestens ein Dienst muss erlaubt sein.', 'bad'); return false; }
      const main = v('main');
      const data = {
        name, type: v('type'), weekly, days, vac: +v('vac') || 0,
        main, alt: $$('input[name=alt]:checked', form).map(x => x.value).filter(x => x !== main),
        allowed: allowed.length === S.shifts.length ? null : allowed,
        offDays: $$('input[name=off]:checked', form).map(x => +x.value),
        from: v('from'), to: v('to'), active: !(v('to') && toDn(v('to')) < todayDn()), trackFrom: fromDn(stand + 1),
        balStart: +v('balStart') || 0, vacRest: +v('vacRest'), vacCarry: 0, vacUsedBefore: 0, note: v('note').trim(),
      };
      let removed = 0;
      mutate(() => {
        if (isNew) state.employees.push(newEmployee(data.type, data));
        else Object.assign(getEmp(id), data);
        if (data.to) removed = removeAfter(isNew ? state.employees[state.employees.length - 1].id : id, toDn(data.to));
      });
      toast(removed ? 'Gespeichert. ' + removed + ' Dienst(e) nach dem Austritt wurden entfernt.' : isNew ? 'Mitarbeiter angelegt' : 'Gespeichert');
    },
  });
}
ACTIONS['emp-delete'] = el => {
  const e = getEmp(el.dataset.id);
  closeModal();
  confirmBox('„' + e.name + '“ mit allen Diensten und Abwesenheiten endgültig löschen? Für Mitarbeiter, die nur ausgeschieden sind, besser „Ausgeschieden“ verwenden, damit die Auswertungen erhalten bleiben.', 'Endgültig löschen', () => {
    mutate(() => deleteEmployees([e.id]));
    toast('Mitarbeiter gelöscht');
  }, true);
};
ACTIONS['emp-deactivate'] = el => openExitDialog(el.dataset.id);
function updateExitPreview(form) {
  const e = getEmp(form.dataset.id), box = form.querySelector('#exitPreview'), d = toDn(form.elements.exit.value);
  if (isNaN(d)) { box.hidden = true; return; }
  const v = vacationSettlement(e, d);
  box.hidden = false;
  box.innerHTML = v ? settlementHtml(v, d) : 'Für dieses Datum ist noch keine Urlaubsberechnung möglich (vor Beginn der Aufzeichnung).';
}
CHANGE['exit-date'] = el => updateExitPreview(el.closest('form'));
function openExitDialog(id) {
  const e = getEmp(id);
  if (!e) return;
  closeModal();
  openModal({
    title: 'Austritt erfassen: ' + e.name, submitLabel: 'Austritt speichern', noFocus: true,
    body: '<label class="fld">Austrittsdatum (letzter Arbeitstag)<input type="date" name="exit" value="' + esc(e.to || fromDn(todayDn())) + '" data-chg="exit-date" required></label>' +
      '<p class="muted mt">Der Urlaub wird aliquot bis zu diesem Tag abgerechnet. Spätere Dienste und Abwesenheiten werden entfernt, die bisherigen Auswertungen bleiben erhalten. Liegt das Datum in der Zukunft, bleibt der Mitarbeiter bis dahin im Dienstplan.</p>' +
      '<div class="note" id="exitPreview"></div>',
    onMount: form => { form.dataset.id = id; updateExitPreview(form); },
    onSubmit: form => {
      const d = toDn(form.elements.exit.value);
      if (isNaN(d)) { toast('Bitte das Austrittsdatum angeben.', 'bad'); return false; }
      if (e.from && d < toDn(e.from)) { toast('Das Austrittsdatum liegt vor dem Eintritt.', 'bad'); return false; }
      let removed = 0;
      mutate(() => { const x = getEmp(id); x.to = fromDn(d); x.active = !(d < todayDn()); removed = removeAfter(id, d); });
      toast('Austritt am ' + fmtDate(d) + ' gespeichert.' + (removed ? ' ' + removed + ' spätere(r) Dienst(e) wurden entfernt.' : '') + ' Die bisherigen Auswertungen bleiben erhalten.');
    },
  });
}
ACTIONS['emp-reactivate'] = el => {
  const id = el.dataset.id;
  closeModal();
  mutate(() => { const e = getEmp(id); e.active = true; e.to = ''; });
  toast('Wieder aktiv');
};

/* ---------- Eintritt und Stände aller Mitarbeiter auf einmal übernehmen ---------- */

ACTIONS['stand-open'] = () => openStandDialog();
function standRowHint(e, stand) {
  const g = standGap(e, stand, todayDn());
  return g && g.saldo <= -4 ? '<span class="minus">≈ ' + fmtSigned(g.saldo) + ' Std. ohne Dienste</span>' : '';
}
function openStandDialog() {
  const list = state.employees.filter(e => !isInactive(e)).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  if (!list.length) { toast('Bitte zuerst Mitarbeiter anlegen.', 'bad'); return; }
  const rows = list.map(e =>
    '<tr><td><b>' + esc(e.name) + '</b><small>' + esc(e.type) + ' · ' + fmtNum(e.weekly, 1).replace(',0', '') + ' Std./Woche · ' + fmtDays(e.vac) + ' Urlaubstage</small></td>' +
    '<td><input type="date" name="f_' + e.id + '" value="' + esc(e.from) + '"></td>' +
    '<td><input type="date" name="d_' + e.id + '" value="' + fromDn(toDn(e.trackFrom) - 1) + '" data-chg="stand-row" data-id="' + e.id + '"></td>' +
    '<td><input type="number" name="v_' + e.id + '" value="' + vacRestOf(e) + '" step="0.5"></td>' +
    '<td><input type="number" name="h_' + e.id + '" value="' + (+e.balStart || 0) + '" step="0.25"></td>' +
    '<td class="rowhint" id="sh_' + e.id + '">' + standRowHint(e, toDn(e.trackFrom) - 1) + '</td></tr>').join('');
  openModal({
    title: 'Eintritt und Stände bestehender Mitarbeiter übernehmen', wide: true, submitLabel: 'Übernehmen', noFocus: true,
    body: '<p class="lead">Für jeden Mitarbeiter das Eintrittsdatum und den Stand laut bisheriger Aufzeichnung eintragen (z. B. letzte Lohnabrechnung). Am Jahrestag des Eintritts kommen jedes Jahr neu die Urlaubstage dazu. „Stand per“ ist der Tag, für den Resturlaub und Plus-/Minusstunden gelten; ab dem Tag danach rechnet das Programm weiter.</p>' +
      '<div class="row2"><label>Gleiches Stand-Datum für alle<input type="date" id="standAll"></label><div class="alignend"><button type="button" class="btn" data-act="stand-all">Datum für alle übernehmen</button></div></div>' +
      '<div class="tablewrap"><table class="list cfg"><thead><tr><th>Mitarbeiter</th><th>Eintritt</th><th>Stand per</th><th>Resturlaub (Tage)</th><th>Plus/Minus (Std.)</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="tip">Liegt der Stand weit zurück, müssen die Dienste seitdem im Dienstplan eingetragen sein, sonst entstehen Minusstunden (rot markiert). Am besten den Tag vor dem ersten Tag wählen, ab dem ihr das Programm nutzt.</p>',
    onSubmit: form => {
      const upd = [];
      for (const e of list) {
        const f = toDn(form.elements['f_' + e.id].value), d = toDn(form.elements['d_' + e.id].value), vr = form.elements['v_' + e.id].value, h = form.elements['h_' + e.id].value;
        if (isNaN(f)) { toast('Bitte für ' + e.name + ' das Eintrittsdatum eintragen.', 'bad'); return false; }
        if (isNaN(d)) { toast('Bitte für ' + e.name + ' das Datum „Stand per“ eintragen.', 'bad'); return false; }
        if (vr === '' || isNaN(+vr)) { toast('Bitte für ' + e.name + ' den Resturlaub eintragen (0 ist erlaubt).', 'bad'); return false; }
        upd.push({ id: e.id, from: fromDn(f), trackFrom: fromDn(d + 1), vacRest: +vr, balStart: +h || 0 });
      }
      mutate(() => { for (const u of upd) Object.assign(getEmp(u.id), { from: u.from, trackFrom: u.trackFrom, vacRest: u.vacRest, balStart: u.balStart, vacCarry: 0, vacUsedBefore: 0 }); });
      toast('Eintritt und Stände von ' + upd.length + ' Mitarbeiter(n) übernommen');
    },
  });
}
ACTIONS['stand-all'] = el => {
  const form = el.closest('form'), v = form.querySelector('#standAll').value;
  if (isNaN(toDn(v))) { toast('Bitte zuerst das gemeinsame Datum wählen.', 'bad'); return; }
  $$('input[name^="d_"]', form).forEach(inp => { inp.value = v; CHANGE['stand-row'](inp); });
};
CHANGE['stand-row'] = el => {
  const e = getEmp(el.dataset.id), cell = $('#sh_' + el.dataset.id);
  if (e && cell) cell.innerHTML = standRowHint(e, toDn(el.value));
};
