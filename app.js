/* Football Subs - UI. All data stays in localStorage on this device. */
(function () {
  'use strict';
  var KEY = 'football-subs-v1';
  var $ = function (id) { return document.getElementById(id); };
  var S;           // app state
  var sel = null;  // plan-table selection {h,b,id}
  var audio = null, wakeLock = null;

  function defaults() {
    var players = [];
    for (var i = 1; i <= 10; i++) players.push({ id: uid(), name: 'Player ' + i, absent: false });
    return { v: 1, view: 'setup', players: players,
      settings: { onField: 7, halfMin: 15, minMin: 10, subInterval: 5 }, plan: null, match: null };
  }
  function uid() { return 'p' + Math.random().toString(36).slice(2, 9); }
  function load() {
    try { var s = JSON.parse(localStorage.getItem(KEY)); if (s && s.v === 1) return s; } catch (e) {}
    return defaults();
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
  function name(id) { var p = S.players.find(function (x) { return x.id === id; }); return p ? (p.name || '?') : '?'; }
  function names(ids) { return ids.map(name).join(', ') || '-'; }
  function esc(t) { return String(t).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function matchStarted() { var m = S.match; return !!(m && (m.half > 1 || m.running || m.elapsedBefore > 0)); }

  /* ---------- views ---------- */
  function show(v) {
    S.view = v; save();
    document.querySelectorAll('.view').forEach(function (el) { el.classList.toggle('active', el.id === 'view-' + v); });
    document.querySelectorAll('.tab').forEach(function (el) { el.classList.toggle('active', el.dataset.view === v); });
    render();
  }
  function render() { if (S.view === 'setup') renderSetup(); else if (S.view === 'plan') renderPlan(); else renderMatch(); }

  function msgs(el, list, okText) {
    el.innerHTML = list.map(function (m) { return '<div class="' + m.c + '">' + esc(m.t) + '</div>'; }).join('') ||
      (okText ? '<div class="ok">' + esc(okText) + '</div>' : '');
  }

  /* ---------- setup ---------- */
  function renderSetup() {
    var ul = $('players'), locked = matchStarted();
    ul.innerHTML = '';
    S.players.forEach(function (p, i) {
      var li = document.createElement('li'); if (p.absent) li.className = 'absent';
      li.innerHTML = '<input value="' + esc(p.name) + '" aria-label="Player name" autocomplete="off" autocorrect="off" spellcheck="false">' +
        '<button class="up" aria-label="Move up">&#9650;</button><button class="dn" aria-label="Move down">&#9660;</button>' +
        '<button class="abs' + (p.absent ? ' on' : '') + '">' + (p.absent ? 'Away' : 'Here') + '</button>' +
        '<button class="rm" aria-label="Remove">&#10005;</button>';
      li.querySelector('input').addEventListener('input', function (e) { p.name = e.target.value; save(); });
      li.querySelector('.up').onclick = function () { if (i > 0) { S.players.splice(i - 1, 0, S.players.splice(i, 1)[0]); save(); renderSetup(); } };
      li.querySelector('.dn').onclick = function () { if (i < S.players.length - 1) { S.players.splice(i + 1, 0, S.players.splice(i, 1)[0]); save(); renderSetup(); } };
      li.querySelector('.abs').onclick = function () {
        if (locked) { alert('Match in progress. Use the Match screen (tap a bench player) for late arrivals.'); return; }
        p.absent = !p.absent; save(); renderSetup();
      };
      li.querySelector('.rm').onclick = function () {
        if (locked) { alert('Match in progress. Reset the match before removing players.'); return; }
        if (confirm('Remove ' + (p.name || 'this player') + '?')) { S.players.splice(i, 1); save(); renderSetup(); }
      };
      ul.appendChild(li);
    });
    ['onField', 'halfMin', 'minMin', 'subInterval'].forEach(function (k) { $(k).value = S.settings[k]; $(k).disabled = locked; });
    $('generate').disabled = locked;
    $('lockNote').textContent = locked ? 'Match in progress: settings are locked. Reset the match to change them.' : '';
    var n = FS.available(S.players).length, f = FS.feasibility(n, S.settings), list = [];
    f.messages.forEach(function (t) { list.push({ c: f.ok ? 'info' : 'bad', t: t }); });
    msgs($('setupMsg'), list, n + ' available. Up to ' + f.maxEvenMin + ' min each per half is possible.');
  }

  function readSettings() {
    var s = {};
    ['onField', 'halfMin', 'minMin', 'subInterval'].forEach(function (k) { s[k] = parseFloat($(k).value); });
    if (!(s.onField >= 1)) s.onField = 7; s.onField = Math.round(s.onField);
    if (!(s.halfMin > 0)) s.halfMin = 15;
    if (!(s.minMin >= 0)) s.minMin = 0;
    if (!(s.subInterval > 0)) s.subInterval = 5;
    S.settings = s; save();
  }

  /* ---------- rotation table ---------- */
  function renderPlan() {
    var box = $('planTables');
    if (!S.plan) { box.innerHTML = '<p>No rotation yet. Go to Setup and tap Generate.</p>'; $('planMsg').innerHTML = ''; return; }
    var chk = FS.checkPlan(S.players, S.settings, S.plan), list = [];
    chk.messages.forEach(function (t) { list.push({ c: chk.ok ? 'info' : 'bad', t: t }); });
    msgs($('planMsg'), list, 'Everyone gets at least ' + S.settings.minMin + ' min each half.');
    var ids = FS.available(S.players, S.match ? S.match.out : []);
    var html = '';
    [0, 1].forEach(function (h) {
      html += '<h3>Half ' + (h + 1) + '</h3><table><tr><th>Player</th>';
      S.plan.starts.forEach(function (st, b) {
        var a = st / FS.MIN, z = a + S.plan.lengths[b];
        html += '<th>' + fmtMin(a) + '&ndash;' + fmtMin(z) + '</th>';
      });
      html += '<th>Min</th><th>Tot</th></tr>';
      ids.forEach(function (id) {
        html += '<tr><td class="name">' + esc(name(id)) + '</td>';
        S.plan.halves[h].forEach(function (blk, b) {
          var on = blk.indexOf(id) >= 0, lk = isLocked(h, b);
          var cls = (on ? 'on' : 'off') + (lk ? ' locked' : '') + (sel && sel.h === h && sel.b === b && sel.id === id ? ' sel' : '');
          html += '<td class="' + cls + '" data-h="' + h + '" data-b="' + b + '" data-id="' + id + '">' + (on ? 'ON' : '&ndash;') + '</td>';
        });
        var hm = chk.minutes.h[h][id] || 0, short = hm < S.settings.minMin - 1e-9 && ids.length >= S.settings.onField;
        html += '<td class="' + (short ? 'short' : '') + '">' + fmtMin(hm) + '</td><td>' + fmtMin(chk.minutes.total[id] || 0) + '</td></tr>';
      });
      html += '</table>';
    });
    box.innerHTML = html;
    box.querySelectorAll('td[data-id]').forEach(function (td) { td.onclick = function () { cellTap(+td.dataset.h, +td.dataset.b, td.dataset.id); }; });
    $('regen').disabled = false;
  }
  function fmtMin(x) { return (Math.round(x * 10) / 10).toString(); }
  function isLocked(h, b) {
    var m = S.match; if (!m || !matchStarted()) return false;
    return h < m.half - 1 || (h === m.half - 1 && (b <= m.applied || m.halfOver));
  }
  function cellTap(h, b, id) {
    if (isLocked(h, b)) return;
    var on = S.plan.halves[h][b].indexOf(id) >= 0;
    if (on) { sel = (sel && sel.id === id && sel.h === h && sel.b === b) ? null : { h: h, b: b, id: id }; }
    else if (sel && sel.h === h && sel.b === b) { FS.swapInBlock(S.plan, h, b, sel.id, id); sel = null; afterPlanEdit(); }
    else { sel = null; }
    renderPlan();
  }
  function afterPlanEdit() {
    // keep the not-yet-started match's starting line-up in step with block 1
    if (S.match && !matchStarted()) S.match = FS.newMatch(S.plan);
    save();
  }

  /* ---------- match ---------- */
  function now() { return Date.now(); }
  function renderMatch() {
    var m = S.match;
    if (!m || !S.plan) { $('clock').textContent = '--:--'; $('nextSub').innerHTML = 'Generate a rotation first (Setup).'; return; }
    var t = now(), E = FS.elapsed(m, S.settings, t);
    $('halfLabel').textContent = (m.finished ? 'Full time' : m.halfOver ? 'Half time' : 'Half ' + m.half) +
      ' \u00b7 ' + FS.fmt(FS.halfMs(S.settings)) + ' halves';
    $('clock').textContent = FS.fmt(E);
    var sp = $('startPause');
    sp.textContent = m.running ? 'Pause' : (E > 0 ? 'Resume' : 'Start half ' + m.half);
    sp.className = 'huge ' + (m.running ? 'warn' : 'primary');
    sp.classList.toggle('hidden', m.halfOver);
    $('half2').classList.toggle('hidden', !(m.halfOver && m.half === 1));
    var ns = FS.nextSub(m, S.settings, S.plan, t), nb = $('nextSub');
    if (ns) {
      nb.className = 'next' + (ns.due ? ' due' : '');
      nb.innerHTML = '<div>' + (ns.due ? 'SUB DUE NOW' : 'Next sub in') + '</div>' +
        (ns.due ? '' : '<div class="cd">' + FS.fmt(ns.inMs + 999) + '</div>') +
        '<div>Off: <span class="offn">' + esc(names(ns.off)) + '</span></div>' +
        '<div>On: <span class="onn">' + esc(names(ns.on)) + '</span></div>';
    } else { nb.className = 'next'; nb.innerHTML = m.halfOver ? (m.finished ? 'Match finished.' : 'Half time. Tap Start half 2 when ready.') : 'No more subs this half.'; }
    $('subDone').disabled = !ns;
    $('subDone').textContent = ns && !ns.due ? 'Sub done (early)' : 'Sub done';
    var row = function (id) {
      return '<li data-id="' + id + '" class="' + (m.out.indexOf(id) >= 0 ? 'out' : '') + '"><span class="nm">' + esc(name(id)) + '</span><span class="m">' +
        FS.fmt(FS.playedMs(m, S.settings, id, m.half, t)) + ' / ' + FS.fmt(FS.totalMs(m, S.settings, id, t)) + '</span></li>';
    };
    var all = S.players.map(function (p) { return p.id; });
    $('fieldList').innerHTML = m.field.map(row).join('');
    $('benchList').innerHTML = all.filter(function (id) { return m.field.indexOf(id) < 0; }).map(function (id) {
      var p = S.players.find(function (x) { return x.id === id; });
      return row(id).replace('</span><span class="m">', (p.absent ? ' (away)' : '') + '</span><span class="m">');
    }).join('');
    $('fieldList').querySelectorAll('li').forEach(function (li) { li.onclick = function () { tapField(li.dataset.id); }; });
    $('benchList').querySelectorAll('li').forEach(function (li) { li.onclick = function () { tapBench(li.dataset.id); }; });
  }

  function loop() {
    if (S.match && S.plan) {
      var ev = FS.tick(S.match, S.settings, S.plan, now());
      if (ev.subAlert) { alertSub(ev.missed); save(); }
      if (ev.halfEnded) { beep(3, 1200); showFlash(S.match.finished ? 'FULL TIME' : 'HALF TIME'); releaseWake(); save(); }
    }
    if (S.view === 'match') renderMatch();
  }

  function alertSub(missed) {
    var ns = FS.nextSub(S.match, S.settings, S.plan, now());
    beep(4, 880);
    if (navigator.vibrate) { try { navigator.vibrate([300, 150, 300, 150, 300]); } catch (e) {} }
    var txt = 'SUB TIME' + (missed > 1 ? ' (' + missed + ' sub times passed while away)' : '');
    if (ns) txt += '<br><small>Off: ' + esc(names(ns.off)) + '<br>On: ' + esc(names(ns.on)) + '</small>';
    showFlash(txt, true);
  }
  function showFlash(html) { $('flashText').innerHTML = html; $('flash').classList.remove('hidden'); }

  function beep(n, freq) {
    try {
      if (!audio) return;
      if (audio.state === 'suspended') audio.resume();
      var t0 = audio.currentTime;
      for (var i = 0; i < n; i++) {
        var o = audio.createOscillator(), g = audio.createGain();
        o.type = 'square'; o.frequency.value = freq || 880;
        g.gain.setValueAtTime(0.0001, t0 + i * 0.35);
        g.gain.exponentialRampToValueAtTime(0.6, t0 + i * 0.35 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.35 + 0.25);
        o.connect(g); g.connect(audio.destination); o.start(t0 + i * 0.35); o.stop(t0 + i * 0.35 + 0.27);
      }
    } catch (e) {}
  }
  function unlockAudio() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!audio && AC) audio = new AC();
      if (audio && audio.state === 'suspended') audio.resume();
    } catch (e) {}
  }
  function requestWake() {
    var note = $('wakeNote');
    if ('wakeLock' in navigator) {
      navigator.wakeLock.request('screen').then(function (l) {
        wakeLock = l; note.textContent = 'Screen will stay on while the clock runs.';
        l.addEventListener('release', function () { wakeLock = null; });
      }).catch(function () { note.textContent = 'Could not keep the screen on. Set Auto-Lock to Never (Settings > Display & Brightness) for the match.'; });
    } else {
      note.textContent = 'This browser cannot keep the screen on. Set Auto-Lock to Never for the match. The clock stays right if the screen locks, but beeps only play while the app is open.';
    }
  }
  function releaseWake() { if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; } }

  function modal(title, buttons) {
    $('modalTitle').textContent = title;
    var body = $('modalBody'); body.innerHTML = '';
    buttons.forEach(function (b) {
      var el = document.createElement('button'); el.className = 'big' + (b.cls ? ' ' + b.cls : ''); el.textContent = b.label;
      el.onclick = function () { closeModal(); b.fn(); }; body.appendChild(el);
    });
    $('modal').classList.remove('hidden');
  }
  function closeModal() { $('modal').classList.add('hidden'); }

  function eligibleBench() {
    var m = S.match;
    return S.players.filter(function (p) { return m.field.indexOf(p.id) < 0 && !p.absent && m.out.indexOf(p.id) < 0; });
  }
  function doSwap(off, on, injured) {
    FS.adHocSwap(S.match, S.settings, S.plan, S.players, off, on, injured, now()); save(); renderMatch();
  }
  function tapField(id) {
    var bench = eligibleBench(), btns = [];
    bench.forEach(function (p) { btns.push({ label: 'Swap with ' + p.name, fn: function () { doSwap(id, p.id, false); } }); });
    bench.forEach(function (p) { btns.push({ label: 'Injured off, ' + p.name + ' on', cls: 'danger', fn: function () { doSwap(id, p.id, true); } }); });
    btns.push({ label: 'Off injured, no replacement', cls: 'danger', fn: function () { doSwap(id, null, true); } });
    modal(name(id) + ' (on the field)', btns);
  }
  function tapBench(id) {
    var m = S.match, p = S.players.find(function (x) { return x.id === id; }), btns = [];
    if (p.absent) {
      btns.push({ label: name(id) + ' has arrived (add to rotation)', cls: 'primary', fn: function () {
        p.absent = false; FS.rebalance(m, S.settings, S.plan, S.players, now()); save(); renderMatch(); } });
    } else if (m.out.indexOf(id) >= 0) {
      btns.push({ label: name(id) + ' is fit again (add back to rotation)', cls: 'primary', fn: function () {
        m.out.splice(m.out.indexOf(id), 1); FS.rebalance(m, S.settings, S.plan, S.players, now()); save(); renderMatch(); } });
    } else {
      m.field.forEach(function (fid) { btns.push({ label: 'On for ' + name(fid), fn: function () { doSwap(fid, id, false); } }); });
      if (m.field.length < S.settings.onField) btns.push({ label: 'On (fill empty spot)', cls: 'primary', fn: function () { doSwap(null, id, false); } });
    }
    modal(name(id) + ' (bench)', btns);
  }

  /* ---------- wiring ---------- */
  function wire() {
    document.querySelectorAll('.tab').forEach(function (b) { b.onclick = function () { show(b.dataset.view); }; });
    $('addPlayer').onclick = function () {
      S.players.push({ id: uid(), name: 'Player ' + (S.players.length + 1), absent: matchStarted() }); save(); renderSetup();
      var ins = document.querySelectorAll('#players input'); var last = ins[ins.length - 1]; if (last) { last.focus(); last.select(); }
    };
    ['onField', 'halfMin', 'minMin', 'subInterval'].forEach(function (k) { $(k).addEventListener('change', function () { readSettings(); renderSetup(); }); });
    $('generate').onclick = function () {
      readSettings();
      if (S.plan && !confirm('Replace the current rotation?')) return;
      S.plan = FS.buildPlan(S.players, S.settings); S.match = FS.newMatch(S.plan); sel = null; save(); show('plan');
    };
    $('regen').onclick = function () {
      if (!S.plan) return;
      if (matchStarted()) { FS.rebalance(S.match, S.settings, S.plan, S.players, now()); }
      else { S.plan = FS.buildPlan(S.players, S.settings); S.match = FS.newMatch(S.plan); }
      sel = null; save(); renderPlan();
    };
    $('toMatch').onclick = function () { show('match'); };
    $('startPause').onclick = function () {
      unlockAudio();
      var m = S.match; if (!m) return;
      if (m.running) { FS.pause(m, S.settings, now()); releaseWake(); }
      else { FS.start(m, now()); requestWake(); }
      save(); renderMatch();
    };
    $('subDone').onclick = function () { if (FS.subDone(S.match, S.settings, S.plan, now())) { save(); renderMatch(); } };
    $('half2').onclick = function () { unlockAudio(); FS.startHalf2(S.match, S.plan, S.players); save(); renderMatch(); };
    $('resetMatch').onclick = function () {
      if (!S.plan || !confirm('Reset the match clock and minutes? The rotation will be regenerated from Setup (manual swaps are lost).')) return;
      S.plan = FS.buildPlan(S.players, S.settings); S.match = FS.newMatch(S.plan); releaseWake(); save(); renderMatch();
    };
    $('flash').onclick = function () { $('flash').classList.add('hidden'); };
    $('modalClose').onclick = closeModal;
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') { loop(); if (S.match && S.match.running) requestWake(); }
      else save();
    });
    window.addEventListener('pageshow', loop);
    document.addEventListener('touchstart', unlockAudio, { passive: true });
  }

  S = load();
  wire();
  show(S.view || 'setup');
  setInterval(loop, 250);
  loop();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(function () {});
})();
