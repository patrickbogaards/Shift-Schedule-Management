'use strict';
/* ===== Oberfläche: Einstellungen ===== */

const netLabel = sh => { const h = netHours(sh.start, sh.end, sh.pause); return h > 0 ? fmtH(h) + ' Std.' : '–'; };

function secBetrieb() {
  const S = state.settings;
  return '<section class="card"><h3>Betrieb</h3><div class="grid2">' +
    '<label class="fld">Name des Restaurants<input type="text" value="' + esc(S.name) + '" data-chg="set-name" data-key="set-name"></label>' +
    '<div class="fld">Öffnungstage<div class="chks">' + WD_SHORT.map((d, k) => '<label class="chk sm"><input type="checkbox" data-chg="set-open" data-k="' + k + '"' + (S.openDays[k] ? ' checked' : '') + '>' + d + '</label>').join('') +
    '</div><small>Nicht angekreuzte Tage sind Ruhetage. Dort wird nicht geplant.</small></div></div></section>';
}
function secPositions() {
  const S = state.settings;
  return '<section class="card"><h3>Positionen</h3><div class="rowset">' + S.positions.map(p =>
    '<div class="rs"><input type="color" value="' + p.color + '" data-chg="pos-color" data-id="' + p.id + '" aria-label="Farbe">' +
    '<input type="text" value="' + esc(p.name) + '" data-chg="pos-name" data-id="' + p.id + '" data-key="pos-' + p.id + '" aria-label="Name der Position">' +
    '<button class="icon-btn" data-act="pos-del" data-id="' + p.id + '" aria-label="Position löschen" title="Position löschen">✕</button></div>').join('') + '</div>' +
    '<button class="btn sm" data-act="pos-add">+ Position hinzufügen</button>' +
    '<p class="tip">Jede Position wird an jedem Öffnungstag besetzt (siehe Mindestbesetzung). Positionen, die noch verwendet werden, lassen sich nicht löschen, aber umbenennen.</p></section>';
}
function secShifts() {
  const S = state.settings;
  const head = '<thead><tr><th>Bezeichnung</th><th>von</th><th>bis</th><th>Pause (Min.)</th><th>Zählt für</th><th class="r">Arbeitszeit</th><th></th></tr></thead>';
  const rows = S.shifts.map(s =>
    '<tr><td><input type="text" value="' + esc(s.name) + '" data-chg="sh-field" data-f="name" data-id="' + s.id + '" data-key="sh-name-' + s.id + '"></td>' +
    '<td><input type="time" value="' + esc(s.start) + '" data-chg="sh-field" data-f="start" data-id="' + s.id + '"></td>' +
    '<td><input type="time" value="' + esc(s.end) + '" data-chg="sh-field" data-f="end" data-id="' + s.id + '"></td>' +
    '<td><input type="number" min="0" max="600" step="5" value="' + (+s.pause || 0) + '" data-chg="sh-field" data-f="pause" data-id="' + s.id + '"></td>' +
    '<td><select data-chg="sh-field" data-f="covers" data-id="' + s.id + '">' + opt('F', 'Früh-Hälfte', s.covers === 'F') + opt('S', 'Spät-Hälfte', s.covers === 'S') + opt('FS', 'Früh + Spät (durchgehend)', s.covers === 'FS') + '</select></td>' +
    '<td class="r">' + netLabel(s) + '</td><td><button class="icon-btn" data-act="sh-del" data-id="' + s.id + '" aria-label="Dienst löschen" title="Dienst löschen">✕</button></td></tr>').join('');
  return '<section class="card"><h3>Dienste</h3><div class="tablewrap"><table class="list cfg">' + head + '<tbody>' + rows + '</tbody></table></div>' +
    '<button class="btn sm" data-act="sh-add">+ Dienst hinzufügen</button>' +
    '<p class="tip">„Zählt für“ legt fest, welche Tageshälfte ein Dienst bei der Mindestbesetzung abdeckt. Ein durchgehender Dienst deckt Früh und Spät ab. Endet ein Dienst nach Mitternacht, einfach die Endzeit (z. B. 01:00) eintragen. Änderungen gelten für neu geplante Dienste; bereits eingeteilte Dienste bleiben unverändert.</p></section>';
}
function secReq() {
  const S = state.settings;
  let head = '<th>Position</th>';
  for (let k = 0; k < 7; k++) head += '<th class="' + (S.openDays[k] ? '' : 'off') + '">' + WD_SHORT[k] + '</th>';
  const rows = S.positions.map(p => {
    let tds = '';
    for (let k = 0; k < 7; k++) {
      const r = S.req[p.id][k];
      tds += '<td class="' + (S.openDays[k] ? '' : 'off') + '"><div class="fs">' +
        '<label title="Mindestens so viele Personen in der Früh-Hälfte">F<input type="number" min="0" max="20" value="' + r[0] + '" data-chg="req" data-p="' + p.id + '" data-k="' + k + '" data-s="0"></label>' +
        '<label title="Mindestens so viele Personen in der Spät-Hälfte">S<input type="number" min="0" max="20" value="' + r[1] + '" data-chg="req" data-p="' + p.id + '" data-k="' + k + '" data-s="1"></label></div></td>';
    }
    return '<tr><th><i class="pdot" style="background:' + p.color + '"></i>' + esc(p.name) + '</th>' + tds + '</tr>';
  }).join('');
  return '<section class="card"><h3>Mindestbesetzung</h3><div class="tablewrap"><table class="list reqt"><thead><tr>' + head + '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
    '<div class="grid2 mt"><label class="fld">Mindestens so viele Personen pro Öffnungstag<input type="number" min="1" max="50" value="' + S.minPersons + '" data-chg="set-minp"></label></div>' +
    '<p class="tip">F = Früh-Hälfte, S = Spät-Hälfte des Tages. Beispiel: „Service F1 S1“ heißt, tagsüber und abends muss jeweils mindestens eine Person im Service sein. Ein durchgehender Dienst zählt für beides. Bei 4 Positionen mit je 1 ergeben sich mindestens 4 Personen pro Tag. Für Stoßzeiten (z. B. Samstag) die Zahl erhöhen.</p></section>';
}
function secRules() {
  const S = state.settings;
  return '<section class="card"><h3>Planungsregeln</h3><div class="grid2">' +
    '<label class="fld">Mindestruhezeit zwischen zwei Diensten (Std.)<input type="number" min="0" max="16" step="0.5" value="' + S.minRestH + '" data-chg="set-rest"><small>Gesetzlicher Regelwert: 11 Stunden. Kollektivvertrag beachten.</small></label>' +
    '<label class="fld">Höchstens so viele Arbeitstage in Folge<input type="number" min="1" max="7" value="' + S.maxConsec + '" data-chg="set-consec"></label>' +
    '<label class="chk"><input type="checkbox" data-chg="set-fair"' + (S.fairWeekends !== false ? ' checked' : '') + '> Wochenenden möglichst fair verteilen</label></div></section>';
}
function secHolidays() {
  const S = state.settings, y = ui.holYear;
  const yearOpts = []; for (let yy = ymd(todayDn()).y - 1; yy <= ymd(todayDn()).y + 3; yy++) yearOpts.push(opt(yy, yy, yy === y));
  const hol = holidaysAT(y).list.map(h => '<tr><td>' + WD_SHORT[wdOf(h.dn)] + ' ' + fmtDate(h.dn) + '</td><td>' + esc(h.name) + '</td>' +
    '<td><label class="chk sm"><input type="checkbox" data-chg="hol-closed" data-iso="' + fromDn(h.dn) + '"' + (S.closedHolidays[fromDn(h.dn)] ? ' checked' : '') + '> Restaurant geschlossen</label></td></tr>').join('');
  const clos = S.closures.slice().sort((a, b) => toDn(a.from) - toDn(b.from)).map(c =>
    '<tr><td>' + fmtDate(toDn(c.from)) + ' – ' + fmtDate(toDn(c.to)) + '</td><td>' + esc(c.note || 'Betriebsruhe') + '</td><td><button class="icon-btn" data-act="clos-del" data-id="' + c.id + '" aria-label="Löschen">✕</button></td></tr>').join('');
  return '<section class="card"><h3>Feiertage und Betriebsruhe</h3>' +
    '<div class="fld inline"><label>Feiertage in <select data-chg="hol-year">' + yearOpts.join('') + '</select></label></div>' +
    '<div class="tablewrap"><table class="list cfg"><tbody>' + hol + '</tbody></table></div>' +
    '<h4>Betriebsruhe / Betriebsurlaub</h4>' +
    (clos ? '<div class="tablewrap"><table class="list cfg"><tbody>' + clos + '</tbody></table></div>' : '<p class="muted">Keine Betriebsruhe eingetragen.</p>') +
    '<button class="btn sm" data-act="clos-add">+ Betriebsruhe eintragen</button>' +
    '<p class="tip">An geschlossenen Tagen wird nicht geplant. Die Mitarbeiter erhalten dafür eine Stundengutschrift, damit keine Minusstunden entstehen. Soll die Betriebsruhe vom Urlaub abgezogen werden, zusätzlich unter „Abwesenheiten“ Urlaub für alle Mitarbeiter eintragen. Gesetzliche Feiertage werden nie als Urlaub gezählt.</p></section>';
}
function secData() {
  let fs;
  if (!fsApi.supported) {
    fs = '<p class="note warn">Dieser Browser (z. B. Firefox oder Safari) kann keinen Datenordner verwenden. Für die dauerhafte Speicherung im Ordner bitte Chrome oder Edge benutzen. Bis dahin liegen die Daten nur im Browser: bitte regelmäßig „Sicherung herunterladen“.</p>';
  } else if (fsApi.dir) {
    const st = fsApi.conflict ? 'Der Ordner enthält abweichende Daten, bitte klären.' : fsApi.ok ? 'Jede Änderung wird automatisch dort gespeichert.' : 'Zurzeit nicht verbunden. Änderungen werden nur im Browser gespeichert, bis die Verbindung wieder erlaubt ist.';
    fs = '<h4>Datenordner</h4><p>Ordner: <b>„' + esc(fsApi.name) + '“</b>. ' + st + '</p>' +
      '<p class="muted">Im Ordner liegt die Datei <code>' + DATA_FILE + '</code> und im Unterordner <code>' + BACKUP_DIR + '</code> je Arbeitstag eine Sicherungskopie (die letzten ' + KEEP_BACKUPS + ').</p>' +
      '<div class="row-btns">' +
      (fsApi.conflict ? '<button class="btn primary" data-act="fs-resolve">Abweichung klären …</button>' : !fsApi.ok ? '<button class="btn primary" data-act="fs-reconnect">Wieder verbinden</button>' : '<button class="btn" data-act="fs-reload">Jetzt aus dem Ordner neu laden</button>') +
      '<button class="btn" data-act="fs-connect">Anderen Ordner wählen …</button><button class="btn" data-act="fs-disconnect">Verbindung trennen</button></div>';
  } else {
    fs = '<h4>Datenordner (empfohlen)</h4><p>Die Daten in einem eigenen Ordner auf dem Computer speichern statt nur im Browser. Darin liegen eine normale Datei mit allen Daten und automatische tägliche Sicherungskopien. Am besten zuerst einen neuen Ordner anlegen (z. B. „Dienstplan-Daten“ in „Dokumente“) und den dann auswählen. Bereits eingegebene Daten werden übernommen.</p>' +
      '<div class="row-btns"><button class="btn primary" data-act="fs-connect">Datenordner wählen …</button></div>';
  }
  return '<section class="card"><h3>Daten und Sicherung</h3>' +
    '<p>Alle Daten bleiben auf diesem Computer, nichts wird ins Internet übertragen. Ohne Datenordner liegen sie nur im Speicher dieses Browsers und sind weg, wenn dieser gelöscht oder ein anderer Browser benutzt wird.</p>' +
    fs +
    '<p><b>Umzug auf einen anderen Computer:</b> Den ganzen Datenordner kopieren (oder in einem Cloud-Ordner ablegen), am neuen Computer die Dienstplan.html öffnen und „Datenordner wählen …“ auswählen. Nicht gleichzeitig auf zwei Computern arbeiten: bei einem Abgleich gilt jeweils der neuere Stand, und es wird vorher gefragt.</p>' +
    '<h4>Sicherung als Einzeldatei (geht in jedem Browser)</h4>' +
    '<div class="row-btns"><button class="btn" data-act="backup">Sicherung herunterladen</button>' +
    '<label class="btn">Sicherung laden …<input type="file" accept=".json,application/json" hidden data-chg="restore-file"></label></div>' +
    '<h4>Sonstiges</h4><div class="row-btns"><button class="btn danger ghost" data-act="reset-all">Alle Daten löschen</button></div></section>';
}

VIEWS.set = function () {
  return '<div class="settings">' + secBetrieb() + secPositions() + secShifts() + secReq() + secRules() + secHolidays() + secData() + '</div>';
};

/* ---------- Änderungen ---------- */

CHANGE['set-name'] = el => mutate(() => { state.settings.name = el.value.trim() || COMPANY_NAME; });
CHANGE['set-open'] = el => mutate(() => { state.settings.openDays[+el.dataset.k] = el.checked; });
CHANGE['set-minp'] = el => mutate(() => { state.settings.minPersons = clamp(Math.round(+el.value || 1), 1, 50); });
CHANGE['set-rest'] = el => mutate(() => { state.settings.minRestH = clamp(+el.value || 0, 0, 16); });
CHANGE['set-consec'] = el => mutate(() => { state.settings.maxConsec = clamp(Math.round(+el.value || 6), 1, 7); });
CHANGE['set-fair'] = el => mutate(() => { state.settings.fairWeekends = el.checked; });
CHANGE['hol-year'] = el => { ui.holYear = +el.value; render(); };
CHANGE['hol-closed'] = el => mutate(() => { if (el.checked) state.settings.closedHolidays[el.dataset.iso] = true; else delete state.settings.closedHolidays[el.dataset.iso]; });
CHANGE.req = el => mutate(() => { state.settings.req[el.dataset.p][+el.dataset.k][+el.dataset.s] = clamp(Math.round(+el.value || 0), 0, 20); });

CHANGE['pos-color'] = el => mutate(() => { getPos(el.dataset.id).color = el.value; });
CHANGE['pos-name'] = el => mutate(() => { getPos(el.dataset.id).name = el.value.trim() || 'Position'; });
ACTIONS['pos-add'] = () => {
  const id = uid('pos_');
  mutate(() => {
    const S = state.settings;
    S.positions.push({ id, name: 'Neue Position', color: POS_COLORS[S.positions.length % POS_COLORS.length] });
    ensureReq(S);
  });
  const el = $('[data-key="pos-' + id + '"]');
  if (el) { el.focus(); el.select(); }
};
ACTIONS['pos-del'] = el => {
  const id = el.dataset.id, S = state.settings;
  const used = state.employees.some(e => e.main === id || (e.alt || []).indexOf(id) >= 0) || Object.keys(state.plan).some(d => state.plan[d].some(en => en.pos === id));
  if (used) { toast('Diese Position wird noch von Mitarbeitern oder in Diensten verwendet und kann nicht gelöscht werden. Sie lässt sich aber umbenennen.', 'bad'); return; }
  if (S.positions.length <= 1) { toast('Mindestens eine Position ist nötig.', 'bad'); return; }
  mutate(() => { S.positions = S.positions.filter(p => p.id !== id); delete S.req[id]; });
};

CHANGE['sh-field'] = el => {
  const sh = getShift(el.dataset.id), f = el.dataset.f;
  let val = el.value;
  if (f === 'name') val = val.trim() || 'Dienst';
  else if (f === 'pause') val = clamp(Math.round(+val || 0), 0, 600);
  else if (f === 'start' || f === 'end') { if (isNaN(parseHM(val))) { render(); return; } }
  const test = Object.assign({}, sh, { [f]: val });
  if (f === 'start' || f === 'end' || f === 'pause') {
    const net = netHours(test.start, test.end, test.pause);
    if (test.start === test.end) { toast('Beginn und Ende dürfen nicht gleich sein.', 'bad'); render(); return; }
    if (!(net > 0)) { toast('Beginn, Ende und Pause ergeben keine positive Arbeitszeit.', 'bad'); render(); return; }
    if (net > 16) { toast('Ein Dienst von mehr als 16 Stunden ist nicht zulässig.', 'bad'); render(); return; }
  }
  mutate(() => { sh[f] = val; });
};
ACTIONS['sh-add'] = () => {
  const id = uid('sh_');
  mutate(() => { state.settings.shifts.push({ id, name: 'Neuer Dienst', start: '12:00', end: '18:00', pause: 30, covers: 'F' }); });
  const el = $('[data-key="sh-name-' + id + '"]');
  if (el) { el.focus(); el.select(); }
};
ACTIONS['sh-del'] = el => {
  const S = state.settings;
  if (S.shifts.length <= 1) { toast('Mindestens ein Dienst ist nötig.', 'bad'); return; }
  const id = el.dataset.id;
  mutate(() => {
    S.shifts = S.shifts.filter(s => s.id !== id);
    state.employees.forEach(e => { if (e.allowed) { e.allowed = e.allowed.filter(x => x !== id); if (!e.allowed.length) e.allowed = null; } });
  });
};

ACTIONS['clos-add'] = () => openModal({
  title: 'Betriebsruhe eintragen',
  body: '<div class="grid2"><label class="fld">Von<input type="date" name="from" required></label><label class="fld">Bis (einschließlich)<input type="date" name="to" required></label>' +
    '<label class="fld full">Bezeichnung<input type="text" name="note" placeholder="z. B. Betriebsurlaub Sommer" value="Betriebsurlaub"></label></div>',
  onSubmit: form => {
    const f = toDn(form.from.value), t = toDn(form.to.value);
    if (isNaN(f) || isNaN(t) || t < f) { toast('Bitte einen gültigen Zeitraum eintragen.', 'bad'); return false; }
    mutate(() => { state.settings.closures.push({ id: uid('c'), from: fromDn(f), to: fromDn(t), note: form.note.value.trim() || 'Betriebsruhe' }); });
  },
});
ACTIONS['clos-del'] = el => mutate(() => { state.settings.closures = state.settings.closures.filter(c => c.id !== el.dataset.id); });

/* ---------- Daten ---------- */

CHANGE['restore-file'] = el => {
  const f = el.files && el.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => restoreFromText(String(r.result));
  r.readAsText(f);
  el.value = '';
};
ACTIONS['fs-connect'] = () => fsConnect();
ACTIONS['fs-disconnect'] = () => fsDisconnect();
ACTIONS['fs-reload'] = () => fsSync(true);
ACTIONS['fs-resolve'] = () => fsConflictPrompt();
ACTIONS['fs-adopt'] = () => { closeModal(); fsAdoptFolder(); };
ACTIONS['fs-overwrite'] = () => { closeModal(); fsOverwriteFolder(); };
ACTIONS['reset-all'] = () => confirmBox('Wirklich ALLE Daten (Mitarbeiter, Pläne, Einstellungen) löschen? Ist ein Datenordner verbunden, wird der bisherige Stand dort im Unterordner „Sicherungen“ aufgehoben.', 'Alles löschen', () => {
  fsSafetyCopy('vor-Loeschen');
  pushUndo();
  state = defaultState();
  afterChange();
  toast('Alle Daten gelöscht');
}, true);
