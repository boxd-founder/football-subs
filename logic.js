/* Football Subs - pure logic (no DOM). Works in the browser and in Node tests. */
(function (root) {
  'use strict';
  var MIN = 60000;

  function round1(x) { return Math.round(x * 10) / 10; }

  // Split a half into sub blocks. A very short final block (< half an interval) is merged into the previous one.
  function blockLengths(halfMin, intervalMin) {
    var out = [], t = 0;
    if (!(halfMin > 0)) return out;
    if (!(intervalMin > 0) || intervalMin >= halfMin) return [halfMin];
    while (t < halfMin - 1e-9) {
      var l = Math.min(intervalMin, halfMin - t);
      out.push(l); t += l;
    }
    if (out.length > 1 && out[out.length - 1] < intervalMin / 2) {
      var last = out.pop(); out[out.length - 1] += last;
    }
    return out.map(round1);
  }

  function startsFrom(lengths) {
    var s = [], t = 0;
    for (var i = 0; i < lengths.length; i++) { s.push(Math.round(t * MIN)); t += lengths[i]; }
    return s;
  }

  // Greedy fair allocation: each block, pick the players with the fewest minutes this half,
  // then fewest overall, preferring to keep whoever is already on (fewer subs), then squad order.
  function generateBlocks(opts) {
    var ids = opts.ids.slice(), k = Math.min(opts.onField, ids.length);
    var half = {}, tot = {}, order = {};
    ids.forEach(function (id, i) {
      half[id] = (opts.startMinutes && opts.startMinutes[id]) || 0;
      tot[id] = (opts.totals && opts.totals[id]) || 0;
      order[id] = opts.order && opts.order[id] != null ? opts.order[id] : i;
    });
    var prev = (opts.initialField || []).filter(function (id) { return ids.indexOf(id) >= 0; });
    var blocks = [];
    opts.lengths.forEach(function (len) {
      var sorted = ids.slice().sort(function (a, b) {
        if (Math.abs(half[a] - half[b]) > 1e-6) return half[a] - half[b];
        if (Math.abs(tot[a] - tot[b]) > 1e-6) return tot[a] - tot[b];
        var pa = prev.indexOf(a) >= 0 ? 0 : 1, pb = prev.indexOf(b) >= 0 ? 0 : 1;
        if (pa !== pb) return pa - pb;
        return order[a] - order[b];
      });
      var pick = sorted.slice(0, k).sort(function (a, b) { return order[a] - order[b]; });
      pick.forEach(function (id) { half[id] += len; tot[id] += len; });
      blocks.push(pick); prev = pick;
    });
    return { blocks: blocks, halfMinutes: half, totals: tot };
  }

  function available(players, extraOut) {
    extraOut = extraOut || [];
    return players.filter(function (p) { return !p.absent && extraOut.indexOf(p.id) < 0; }).map(function (p) { return p.id; });
  }

  function orderMap(players) { var o = {}; players.forEach(function (p, i) { o[p.id] = i; }); return o; }

  // Aggregate feasibility of the minimum (ignores block granularity; checkPlan covers that).
  function feasibility(nAvail, s) {
    var res = { ok: true, messages: [], maxEvenMin: null };
    if (nAvail === 0) { res.ok = false; res.messages.push('No players available. Add players or unmark absent ones.'); return res; }
    if (nAvail < s.onField) {
      res.messages.push('Only ' + nAvail + ' available for ' + s.onField + ' places: everyone plays the whole half (short-handed).');
      return res;
    }
    var maxEven = s.onField * s.halfMin / nAvail;
    res.maxEvenMin = round1(maxEven);
    if (s.minMin > maxEven + 1e-9) {
      res.ok = false;
      res.messages.push('Minimum of ' + s.minMin + ' min per half is impossible: ' + nAvail + ' players sharing ' +
        s.onField + ' places for ' + s.halfMin + ' min gives at most ' + round1(maxEven) + ' min each on average.');
    }
    return res;
  }

  function buildPlan(players, s) {
    var ids = available(players), order = orderMap(players);
    var lengths = blockLengths(s.halfMin, s.subInterval);
    var h1 = generateBlocks({ ids: ids, onField: s.onField, lengths: lengths, order: order });
    var h2 = generateBlocks({ ids: ids, onField: s.onField, lengths: lengths, order: order, totals: h1.totals,
      initialField: null });
    return { lengths: lengths, starts: startsFrom(lengths), halves: [h1.blocks, h2.blocks] };
  }

  // Planned minutes per player per half from a plan.
  function planMinutes(plan, ids) {
    var res = { h: [{}, {}], total: {} };
    ids.forEach(function (id) { res.h[0][id] = 0; res.h[1][id] = 0; res.total[id] = 0; });
    plan.halves.forEach(function (blocks, h) {
      blocks.forEach(function (b, i) {
        b.forEach(function (id) {
          if (res.h[h][id] == null) { res.h[h][id] = 0; res.total[id] = res.total[id] || 0; }
          res.h[h][id] += plan.lengths[i]; res.total[id] += plan.lengths[i];
        });
      });
    });
    return res;
  }

  // Full check: aggregate feasibility + who misses the minimum in the actual plan.
  function checkPlan(players, s, plan) {
    var ids = available(players), f = feasibility(ids.length, s);
    var pm = planMinutes(plan, ids), short = [];
    if (ids.length >= s.onField) {
      ids.forEach(function (id) {
        [0, 1].forEach(function (h) { if (pm.h[h][id] < s.minMin - 1e-9) short.push({ id: id, half: h + 1, minutes: round1(pm.h[h][id]) }); });
      });
    }
    if (f.ok && short.length) {
      f.ok = false;
      f.messages.push('With ' + s.subInterval + '-min sub blocks, ' + short.length +
        ' player-half(s) fall below the ' + s.minMin + '-min minimum. Try a shorter sub interval or a lower minimum.');
    }
    f.short = short; f.minutes = pm;
    return f;
  }

  // Swap two players within one block of the plan (tap-to-swap editing). Returns true if changed.
  function swapInBlock(plan, half, block, offId, onId) {
    var b = plan.halves[half][block];
    var i = b.indexOf(offId);
    if (i < 0 || b.indexOf(onId) >= 0) return false;
    b[i] = onId; return true;
  }

  /* ---------------- Match clock & state (timestamps only) ---------------- */

  function newMatch(plan) {
    var field = plan.halves[0][0] ? plan.halves[0][0].slice() : [];
    var entered = {}; field.forEach(function (id) { entered[id] = 0; });
    return { half: 1, running: false, startedAt: null, elapsedBefore: 0, field: field, enteredAt: entered,
      played: [{}, {}], applied: 0, alerted: 0, out: [], halfOver: false, finished: false, log: [] };
  }

  function halfMs(s) { return Math.round(s.halfMin * MIN); }

  function elapsed(m, s, now) {
    var e = m.elapsedBefore + (m.running ? Math.max(0, now - m.startedAt) : 0);
    return Math.min(e, halfMs(s));
  }

  function start(m, now) { if (!m.running && !m.halfOver) { m.running = true; m.startedAt = now; } return m; }
  function pause(m, s, now) { if (m.running) { m.elapsedBefore = elapsed(m, s, now); m.running = false; m.startedAt = null; } return m; }

  function playedMs(m, s, id, h, now) {
    var base = (m.played[h - 1][id] || 0);
    if (h === m.half && m.field.indexOf(id) >= 0 && m.enteredAt[id] != null) base += elapsed(m, s, now) - m.enteredAt[id];
    return base;
  }
  function totalMs(m, s, id, now) { return playedMs(m, s, id, 1, now) + playedMs(m, s, id, 2, now); }

  // Change who is on, at match-clock time E. Players leaving bank their minutes.
  function setField(m, newField, E) {
    var h = m.half - 1;
    m.field.forEach(function (id) {
      if (newField.indexOf(id) < 0) { m.played[h][id] = (m.played[h][id] || 0) + (E - m.enteredAt[id]); delete m.enteredAt[id]; }
    });
    newField.forEach(function (id) { if (m.field.indexOf(id) < 0) m.enteredAt[id] = E; });
    m.field = newField.slice();
  }

  function dueBlock(plan, E) {
    var d = 0;
    for (var i = 0; i < plan.starts.length; i++) if (plan.starts[i] <= E) d = i;
    return d;
  }

  function diff(field, target) {
    return { off: field.filter(function (id) { return target.indexOf(id) < 0; }),
             on: target.filter(function (id) { return field.indexOf(id) < 0; }) };
  }

  // Called on every tick and on return from background. Returns events to show/play.
  function tick(m, s, plan, now) {
    var ev = { subAlert: false, missed: 0, halfEnded: false };
    var E = elapsed(m, s, now);
    var d = dueBlock(plan, E);
    if (d > m.alerted && d > m.applied) {
      var blocks = plan.halves[m.half - 1];
      var ch = diff(m.field, blocks[d]);
      ev.missed = d - Math.max(m.alerted, m.applied);
      ev.subAlert = ch.off.length + ch.on.length > 0;
      m.alerted = d;
    }
    if (m.running && E >= halfMs(s)) {
      pause(m, s, now);
      m.field.forEach(function (id) { m.played[m.half - 1][id] = (m.played[m.half - 1][id] || 0) + (halfMs(s) - m.enteredAt[id]); });
      m.enteredAt = {};
      m.halfOver = true; if (m.half === 2) m.finished = true;
      ev.halfEnded = true;
    }
    return ev;
  }

  // What to show as the next sub.
  function nextSub(m, s, plan, now) {
    var E = elapsed(m, s, now), blocks = plan.halves[m.half - 1];
    if (m.halfOver) return null;
    var d = dueBlock(plan, E);
    if (d > m.applied) { var c = diff(m.field, blocks[d]); return { block: d, due: true, inMs: 0, off: c.off, on: c.on }; }
    for (var i = m.applied + 1; i < blocks.length; i++) {
      var c2 = diff(m.field, blocks[i]);
      if (c2.off.length || c2.on.length) return { block: i, due: false, inMs: plan.starts[i] - E, off: c2.off, on: c2.on };
    }
    return null;
  }

  // Confirm the shown sub (works when due, or early).
  function subDone(m, s, plan, now) {
    var ns = nextSub(m, s, plan, now);
    if (!ns) return false;
    var E = elapsed(m, s, now);
    setField(m, plan.halves[m.half - 1][ns.block].filter(function (id) { return m.out.indexOf(id) < 0; }), E);
    m.applied = ns.block; m.alerted = Math.max(m.alerted, ns.block);
    m.log.push({ t: E, half: m.half, type: 'sub', block: ns.block });
    return true;
  }

  // Re-plan every not-yet-applied block (and half 2) from actual minutes played.
  function rebalance(m, s, plan, players, now) {
    var E = elapsed(m, s, now), h = m.half - 1, order = orderMap(players);
    var ids = available(players, m.out);
    var from = m.applied + 1;
    var projH = {}, projT = {};
    ids.forEach(function (id) {
      projH[id] = playedMs(m, s, id, m.half, now) / MIN;
      projT[id] = totalMs(m, s, id, now) / MIN;
    });
    var field = m.field.filter(function (id) { return ids.indexOf(id) >= 0; });
    if (!m.halfOver && from < plan.lengths.length) {
      var gap = Math.max(0, plan.starts[from] - E) / MIN;
      field.forEach(function (id) { projH[id] += gap; projT[id] += gap; });
      var g = generateBlocks({ ids: ids, onField: s.onField, lengths: plan.lengths.slice(from), startMinutes: projH,
        totals: projT, initialField: field, order: order });
      for (var i = 0; i < g.blocks.length; i++) plan.halves[h][from + i] = g.blocks[i];
      projT = g.totals;
    } else if (!m.halfOver) {
      var rem = Math.max(0, halfMs(s) - E) / MIN;
      field.forEach(function (id) { projT[id] += rem; });
    }
    if (m.half === 1) {
      var g2 = generateBlocks({ ids: ids, onField: s.onField, lengths: plan.lengths, totals: projT, order: order,
        initialField: m.halfOver ? field : null });
      plan.halves[1] = g2.blocks;
    }
    return plan;
  }

  // Ad-hoc swap now (injury, tactical, late arrival). injured=true keeps the player out for the rest of the match.
  function adHocSwap(m, s, plan, players, offId, onId, injured, now) {
    var E = elapsed(m, s, now);
    var nf = m.field.slice();
    if (offId != null) { var i = nf.indexOf(offId); if (i >= 0) nf.splice(i, 1); }
    if (onId != null && nf.indexOf(onId) < 0) nf.push(onId);
    if (m.halfOver) {
      m.field = nf; // between halves: just record who's on
    } else {
      setField(m, nf, E);
    }
    if (injured && offId != null && m.out.indexOf(offId) < 0) m.out.push(offId);
    if (onId != null) { var j = m.out.indexOf(onId); if (j >= 0) m.out.splice(j, 1); }
    m.log.push({ t: E, half: m.half, type: 'swap', off: offId, on: onId, injured: !!injured });
    rebalance(m, s, plan, players, now);
    return m;
  }

  function startHalf2(m, plan, players) {
    var ids = available(players, m.out);
    var field = (plan.halves[1][0] || []).filter(function (id) { return ids.indexOf(id) >= 0; });
    m.half = 2; m.running = false; m.startedAt = null; m.elapsedBefore = 0; m.halfOver = false;
    m.field = field; m.enteredAt = {}; field.forEach(function (id) { m.enteredAt[id] = 0; });
    m.applied = 0; m.alerted = 0;
    return m;
  }

  function fmt(ms) {
    ms = Math.max(0, ms); var t = Math.floor(ms / 1000);
    var mm = Math.floor(t / 60), ss = t % 60;
    return (mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss;
  }

  var api = { MIN: MIN, blockLengths: blockLengths, startsFrom: startsFrom, generateBlocks: generateBlocks,
    available: available, feasibility: feasibility, buildPlan: buildPlan, planMinutes: planMinutes, checkPlan: checkPlan,
    swapInBlock: swapInBlock, newMatch: newMatch, elapsed: elapsed, start: start, pause: pause, playedMs: playedMs,
    totalMs: totalMs, setField: setField, dueBlock: dueBlock, diff: diff, tick: tick, nextSub: nextSub, subDone: subDone,
    rebalance: rebalance, adHocSwap: adHocSwap, startHalf2: startHalf2, fmt: fmt, halfMs: halfMs };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FS = api;
})(this);
