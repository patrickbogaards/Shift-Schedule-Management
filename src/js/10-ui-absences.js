'use strict';
/* ===== Oberfläche: Abwesenheiten (Urlaub, Krankenstand, Zeitausgleich) ===== */

VIEWS.abs = function () {
  const y = ui.absYear, ef = ui.absEmp;
  const from = dnOf(y, 1, 1), to = dnOf(y, 12, 31);
  const list = state.absences
    .filter(a => (!ef || a.emp === ef) && getEmp(a.emp) && toDn(a.to) >= from && toDn(a.from) <= to)
    .sort((a, b) => toDn(a.from) - toDn(b.from) || getEmp(a.emp).name.localeCompare(getEmp(b.emp).name, 'de'));
  const rows = list.map(a => {
    const e = getEmp(a.emp), f = toDn(a.from), t = toDn(a.to);
    let days = 0;
    for (const r of empDayRecords(e, f, t)) if (r.abs === a.type && ((a.type === 'urlaub' && r.vac) || (a.type === 'krank' && r.sick) || (a.type === 'za' && r.za) || (a.type === 'frei' && r.cat === 'frei'))) days++;
    const cal = t - f + 1;
    return '<tr class="click" data-act="abs-edit" data-id="' + a.id + '"><td><b>' + esc(e.name) + '</b></td><td><span class="abadge a-' + a.type + '">' + esc(ABS_TYPES[a.type]) + '</span></td>' +
      '<td>' + WD_SHORT[wdOf(f)] + ' ' + fmtDate(f) + '</td><td>' + WD_SHORT[wdOf(t)] + ' ' + fmtDate(t) + '</td>' +
      '<td class="r" title="' + cal + ' Kalendertage im Zeitraum">' + (a.type === 'frei' ? '–' : days) + '</td><td class="muted">' + esc(a.note || '') + '</td></tr>';
  }).join('');
  const yearOpts = []; for (let yy = ymd(todayDn()).y - 2; yy <= ymd(todayDn()).y + 2; yy++) yearOpts.push(opt(yy, yy, yy === y));
  return '<div class="toolbar no-print"><div class="filters">' +
    '<label>Jahr <select data-chg="abs-year">' + yearOpts.join('') + '</select></label>' +
    '<label>Mitarbeiter <select data-chg="abs-emp">' + opt('', 'Alle', !ef) + state.employees.map(e => opt(e.id, e.name, e.id === ef)).join('') + '</select></label></div>' +
    '<div class="tools"><button class="btn primary" data-act="abs-new">+ Abwesenheit eintragen</button></div></div>' +
    '<section class="card"><h3>Urlaub, Krankenstand und Zeitausgleich</h3>' +
    (rows ? '<div class="tablewrap"><table class="list"><thead><tr><th>Mitarbeiter</th><th>Art</th><th>Von</th><th>Bis</th><th class="r">Tage (angerechnet)</th><th>Notiz</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      : '<p class="muted pad">Für ' + y + ' sind keine Abwesenheiten eingetragen.</p>') +
    '<p class="tip">Die automatische Planung teilt an diesen Tagen niemanden ein. Angerechnet werden nur Tage, an denen die Person laut Arbeitstagen pro Woche und freien Tagen gearbeitet hätte; Feiertage zählen nicht als Urlaub. Krankenstand und Urlaub werden mit den Tagesstunden gutgeschrieben, Zeitausgleich baut Plusstunden ab.</p></section>';
};
CHANGE['abs-year'] = el => { ui.absYear = +el.value; render(); };
CHANGE['abs-emp'] = el => { ui.absEmp = el.value; render(); };
ACTIONS['abs-new'] = () => openAbsEditor(null);
ACTIONS['abs-edit'] = el => openAbsEditor(el.dataset.id);

function openAbsEditor(id) {
  if (!state.employees.length) { toast('Bitte zuerst Mitarbeiter anlegen.', 'bad'); return; }
  const isNew = !id;
  const a = isNew ? { emp: ui.absEmp || state.employees[0].id, from: fromDn(todayDn()), to: fromDn(todayDn()), type: 'urlaub', note: '' } : state.absences.find(x => x.id === id);
  if (!a) return;
  const empOpts = state.employees.filter(e => e.active !== false || e.id === a.emp).map(e => opt(e.id, e.name, e.id === a.emp)).join('');
  const body =
    '<div class="grid2">' +
    '<label class="fld full">Mitarbeiter<select name="emp">' + (isNew ? opt('*', 'Alle Mitarbeiter (z. B. Betriebsurlaub)', false) : '') + empOpts + '</select></label>' +
    '<label class="fld full">Art<select name="type">' + Object.keys(ABS_TYPES).map(t => opt(t, ABS_TYPES[t] + (t === 'frei' ? ' – Wunsch, ohne Gutschrift und ohne Urlaubsabzug' : ''), a.type === t)).join('') + '</select></label>' +
    '<label class="fld">Von<input type="date" name="from" value="' + esc(a.from) + '" required></label>' +
    '<label class="fld">Bis (einschließlich)<input type="date" name="to" value="' + esc(a.to) + '" required></label>' +
    '<label class="fld full">Notiz (optional)<input type="text" name="note" value="' + esc(a.note || '') + '"></label></div>';
  openModal({
    title: isNew ? 'Abwesenheit eintragen' : 'Abwesenheit bearbeiten', body,
    extraHtml: isNew ? '' : '<button type="button" class="btn danger ghost" data-act="abs-delete" data-id="' + a.id + '">Löschen</button>',
    onSubmit: form => {
      const f = toDn(form.from.value), t = toDn(form.to.value);
      if (isNaN(f) || isNaN(t)) { toast('Bitte Beginn und Ende eintragen.', 'bad'); return false; }
      if (t < f) { toast('Das Ende liegt vor dem Beginn.', 'bad'); return false; }
      if (t - f > 366) { toast('Der Zeitraum darf höchstens ein Jahr umfassen.', 'bad'); return false; }
      const type = form.type.value, note = form.note.value.trim();
      const targets = form.emp.value === '*' ? state.employees.filter(e => e.active !== false).map(e => e.id) : [form.emp.value];
      let removed = 0;
      mutate(() => {
        if (!isNew) {
          state.absences = state.absences.filter(x => x.id !== id);
          mergeAbsences(a.emp);
        }
        for (const emp of targets) {
          // ältere Abwesenheiten im gleichen Zeitraum überschreiben (Tag für Tag)
          for (let d = f; d <= t; d++) setAbsenceDay(emp, d, null);
          state.absences.push({ id: uid('a'), emp, from: fromDn(f), to: fromDn(t), type, note });
          mergeAbsences(emp);
          if (type !== 'frei') removed += removeEntriesOf(emp, f, t);
        }
      });
      toast(removed ? 'Gespeichert. ' + removed + ' bereits eingetragene(r) Dienst(e) in diesem Zeitraum wurden entfernt.' : 'Gespeichert');
    },
  });
}
ACTIONS['abs-delete'] = el => {
  const id = el.dataset.id;
  closeModal();
  const a = state.absences.find(x => x.id === id);
  mutate(() => { state.absences = state.absences.filter(x => x.id !== id); if (a) mergeAbsences(a.emp); });
  toast('Abwesenheit gelöscht');
};
