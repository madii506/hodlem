/* HODLEM table window: the "Poker" frame from Bitcoin v0.1 (CPokerDialogBase), finished.
 * Mounts a playable heads-up table into any element. Used by the site and by /play (the X card). */
(function () {
  'use strict';
  const P = window.Poker;
  const W = 806, H = 398;                 // painted client area (the original frame is 806x550)
  const DIV = 1e5;                        // chip units: 1 = 0.00001 BTC
  const EPOCHS = [
    { id: 'e1', name: 'Genesis', block: 0, date: '2009-01-03', reward: 50, bb: 50000, sb: 25000, level: 1, bot: '1A1zP1…DivfNa', unlock: 0 },
    { id: 'e2', name: 'First Halving', block: 210000, date: '2012-11-28', reward: 25, bb: 25000, sb: 12500, level: 2, bot: 'miner·210000', unlock: 50000 },
    { id: 'e3', name: 'Second Halving', block: 420000, date: '2016-07-09', reward: 12.5, bb: 12500, sb: 6250, level: 3, bot: 'miner·420000', unlock: 150000 },
    { id: 'e4', name: 'Third Halving', block: 630000, date: '2020-05-11', reward: 6.25, bb: 6250, sb: 3125, level: 4, bot: 'miner·630000', unlock: 500000 },
    { id: 'e5', name: 'Fourth Halving', block: 840000, date: '2024-04-20', reward: 3.125, bb: 3125, sb: 1563, level: 5, bot: 'miner·840000', unlock: 1000000 },
  ];
  EPOCHS.forEach(e => { e.stack = Math.round(e.reward * DIV); });

  /* ---------- storage (works without it, e.g. inside the X card) ---------- */
  const KEY = 'hodlem:v1';
  const store = {
    load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } },
    save(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { } },
  };
  const data = Object.assign({ stacks: {}, stats: { hands: 0, won: 0, lost: 0, biggest: 0, best: 0, busts: 0, botBusts: 0, showdowns: 0 }, history: [], snd: true }, store.load());
  data.stats = Object.assign({ hands: 0, won: 0, lost: 0, biggest: 0, best: 0, busts: 0, botBusts: 0, showdowns: 0 }, data.stats || {});
  const persist = () => store.save(data);
  // table options (the Options window): deck colours, card back, felt, odds, speed, auto-deal
  const PREF_DEF = { fourColor: false, back: 'orange', felt: 'green', odds: false, fast: false, autoDeal: true };
  const PREF = data.prefs = Object.assign({}, PREF_DEF, data.prefs || {});
  const BACKS = { orange: ['#c8700a', '#fff5e4'], blue: ['#1f4aa8', '#e6eeff'], red: ['#a3161b', '#ffe9e9'], black: ['#1d1d1d', '#f7931a'] };
  const FELTS = { green: ['#2f9a52', '#1d7a3c', '#125a2a', '#0e3220'], blue: ['#2f6fb0', '#1d4f8a', '#123a6a', '#0b1f35'], red: ['#a8343a', '#83222a', '#5e1419', '#2a0b0d'], black: ['#3a3a3a', '#262626', '#161616', '#0a0a0a'] };
  const SUIT4 = ['#111', '#c4141b', '#1f4fd1', '#16812f'];

  /* ---------- sound (tiny square-wave bleeps, off until a click) ---------- */
  let actx = null;
  function beep(freq, dur = 0.05, type = 'square', vol = 0.03, when = 0) {
    if (!data.snd) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const t = actx.currentTime + when, o = actx.createOscillator(), g = actx.createGain();
      o.type = type; o.frequency.value = freq; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur + 0.02);
    } catch (e) { }
  }
  const SFX = {
    deal: () => beep(880, 0.03, 'square', 0.02), chip: () => { beep(1400, 0.025, 'triangle', 0.03); beep(1900, 0.02, 'triangle', 0.02, 0.03); },
    check: () => beep(320, 0.04, 'square', 0.025), fold: () => beep(180, 0.08, 'sawtooth', 0.02),
    win: () => [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.09, 'square', 0.03, i * 0.08)),
    lose: () => [392, 330, 262].forEach((f, i) => beep(f, 0.1, 'square', 0.025, i * 0.09)),
    turn: () => beep(660, 0.05, 'triangle', 0.03),
  };

  /* ---------- card painting (our own faces, classic 71x96 proportions) ---------- */
  const RED = '#c4141b', INK = '#111';
  const SUIT = ['♠', '♥', '♦', '♣'];
  const PIPS = { // [x, y, flipped] in a 0..1 box
    2: [[.5, .18], [.5, .82, 1]], 3: [[.5, .18], [.5, .5], [.5, .82, 1]], 4: [[.3, .18], [.7, .18], [.3, .82, 1], [.7, .82, 1]],
    5: [[.3, .18], [.7, .18], [.5, .5], [.3, .82, 1], [.7, .82, 1]], 6: [[.3, .18], [.7, .18], [.3, .5], [.7, .5], [.3, .82, 1], [.7, .82, 1]],
    7: [[.3, .18], [.7, .18], [.5, .34], [.3, .5], [.7, .5], [.3, .82, 1], [.7, .82, 1]],
    8: [[.3, .18], [.7, .18], [.5, .34], [.3, .5], [.7, .5], [.5, .66, 1], [.3, .82, 1], [.7, .82, 1]],
    9: [[.3, .16], [.7, .16], [.3, .39], [.7, .39], [.5, .5], [.3, .61, 1], [.7, .61, 1], [.3, .84, 1], [.7, .84, 1]],
    10: [[.3, .16], [.7, .16], [.5, .29], [.3, .39], [.7, .39], [.3, .61, 1], [.7, .61, 1], [.5, .71, 1], [.3, .84, 1], [.7, .84, 1]],
  };
  function rr(x, X, Y, w, h, r) { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath(); }
  function drawCard(x, c, X, Y, w, h, up, glow) {
    x.save();
    if (glow) { x.shadowColor = 'rgba(255,200,60,.9)'; x.shadowBlur = 14; }
    else { x.shadowColor = 'rgba(0,0,0,.45)'; x.shadowBlur = 4; x.shadowOffsetY = 2; }
    rr(x, X, Y, w, h, Math.max(3, w * 0.07)); x.fillStyle = up ? '#fdfdfb' : '#f6f1e6'; x.fill();
    x.shadowColor = 'transparent'; x.lineWidth = 1; x.strokeStyle = '#222'; x.stroke();
    if (!up) {
      const BK = BACKS[PREF.back] || BACKS.orange;
      rr(x, X + w * 0.08, Y + w * 0.08, w * 0.84, h - w * 0.16, 3); x.fillStyle = BK[0]; x.fill(); x.save(); x.clip();
      x.strokeStyle = 'rgba(255,236,200,.38)'; x.lineWidth = 1;
      for (let i = -h; i < w + h; i += 6) { x.beginPath(); x.moveTo(X + i, Y); x.lineTo(X + i + h, Y + h); x.stroke(); x.beginPath(); x.moveTo(X + i, Y); x.lineTo(X + i - h, Y + h); x.stroke(); }
      x.restore();
      x.fillStyle = BK[1]; x.beginPath(); x.arc(X + w / 2, Y + h / 2, w * 0.2, 0, 7); x.fill();
      x.fillStyle = BK[0]; x.font = '900 ' + Math.round(w * 0.26) + 'px Tahoma, Verdana, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('₿', X + w / 2, Y + h / 2 + 1);
      x.restore(); return;
    }
    const r = c % 13, s = (c / 13) | 0, col = PREF.fourColor ? SUIT4[s] : (s === 1 || s === 2) ? RED : INK, R0 = '23456789TJQKA'[r], rk = R0 === 'T' ? '10' : R0;
    x.fillStyle = col; x.textAlign = 'center'; x.textBaseline = 'alphabetic';
    const fs = Math.round(w * 0.26);
    const corner = () => { x.font = 'bold ' + fs + 'px "Times New Roman", Times, serif'; x.fillText(rk, X + w * 0.15, Y + fs * 0.95); x.font = Math.round(fs * 0.85) + 'px "Segoe UI Symbol", "DejaVu Sans", sans-serif'; x.fillText(SUIT[s], X + w * 0.15, Y + fs * 1.8); };
    corner(); x.save(); x.translate(X + w, Y + h); x.rotate(Math.PI); x.translate(-X, -Y); corner(); x.restore();
    const n = r + 2;
    const bx = X + w * 0.22, by = Y + h * 0.08, bw = w * 0.56, bh = h * 0.84;
    if (n <= 10) {
      const ps = Math.round(w * (n === 10 || n === 9 ? 0.2 : 0.23));
      x.font = ps + 'px "Segoe UI Symbol", "DejaVu Sans", sans-serif'; x.textBaseline = 'middle';
      for (const [px, py, fl] of PIPS[n]) { x.save(); x.translate(bx + px * bw, by + py * bh); if (fl) x.rotate(Math.PI); x.fillText(SUIT[s], 0, 0); x.restore(); }
    } else if (n === 14) {
      x.font = Math.round(w * 0.62) + 'px "Segoe UI Symbol", "DejaVu Sans", sans-serif'; x.textBaseline = 'middle'; x.fillText(SUIT[s], X + w / 2, Y + h / 2 + 2);
    } else {
      // our own court cards: a framed panel, the rank and a little crown
      x.strokeStyle = col; x.lineWidth = 1.2; x.strokeRect(bx, by + 2, bw, bh - 4);
      x.fillStyle = col === INK ? 'rgba(17,17,17,.06)' : col + '14'; x.fillRect(bx, by + 2, bw, bh - 4);
      x.fillStyle = '#d9a21b'; const cx = X + w / 2, cy = Y + h * 0.33, cw = w * 0.3;
      x.beginPath(); x.moveTo(cx - cw / 2, cy + cw * 0.3); x.lineTo(cx - cw / 2, cy - cw * 0.15); x.lineTo(cx - cw / 4, cy + cw * 0.05); x.lineTo(cx, cy - cw * 0.3); x.lineTo(cx + cw / 4, cy + cw * 0.05); x.lineTo(cx + cw / 2, cy - cw * 0.15); x.lineTo(cx + cw / 2, cy + cw * 0.3); x.closePath(); x.fill();
      x.fillStyle = col; x.font = 'bold ' + Math.round(w * 0.42) + 'px "Times New Roman", Times, serif'; x.textBaseline = 'middle'; x.fillText(rk, cx, Y + h * 0.6);
      x.font = Math.round(w * 0.22) + 'px "Segoe UI Symbol", "DejaVu Sans", sans-serif'; x.fillText(SUIT[s], cx, Y + h * 0.8);
    }
    x.restore();
  }
  function drawChips(x, cx, cy, amt, bb) {
    if (amt <= 0) return;
    const n = Math.max(1, Math.min(9, Math.ceil(Math.log2(amt / bb * 2 + 1))));
    const cols = [['#f7931a', '#fff5e4'], ['#1d1d1d', '#f7931a'], ['#fff5e4', '#c8700a']];
    for (let i = 0; i < n; i++) {
      const [a, b] = cols[i % 3]; const y = cy - i * 3;
      x.fillStyle = 'rgba(0,0,0,.35)'; x.beginPath(); x.ellipse(cx, y + 2, 11, 5, 0, 0, 7); x.fill();
      x.fillStyle = a; x.beginPath(); x.ellipse(cx, y, 11, 5, 0, 0, 7); x.fill();
      x.strokeStyle = b; x.lineWidth = 2; x.setLineDash([3, 3]); x.beginPath(); x.ellipse(cx, y, 9, 4, 0, 0, 7); x.stroke(); x.setLineDash([]);
    }
  }

  /* ---------- the window ---------- */
  const SEATS = 10, CX = 403, CY = 178, RX = 352, RY = 152;
  const seatPos = i => { const a = Math.PI / 2 + i * 2 * Math.PI / SEATS; return { x: CX + Math.cos(a) * RX, y: CY + Math.sin(a) * RY }; };
  // seat 0 (you) bottom-center, seat 5 (the bot) top-center
  const MAP = [0, 5];

  function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  function mount(root, opts = {}) {
    const compact = !!opts.compact;
    let epoch = EPOCHS.find(e => e.id === opts.epoch) || EPOCHS[0];
    root.classList.add('pw-root'); if (compact) root.classList.add('compact');
    root.innerHTML = `
      <div class="pw-stage"><canvas class="pw-canvas" width="${W}" height="${H}" aria-label="Poker table"></canvas>
        <div class="pw-msg" hidden></div></div>
      <div class="pw-ctrl">
        <div class="pw-row r1">
          <label class="xp-check"><input type="checkbox" data-pre="fold"><i></i>FOLD</label>
          <label class="xp-check"><input type="checkbox" data-pre="call"><i></i>CALL</label>
          <label class="xp-check"><input type="checkbox" data-pre="callany"><i></i>CALL ANY</label>
          <label class="xp-check"><input type="checkbox" data-pre="raise"><i></i>RAISE</label>
          <label class="xp-check"><input type="checkbox" data-pre="raiseany"><i></i>RAISE ANY</label>
          <span class="sp"></span>
          <label class="xp-check"><input type="checkbox" data-k="sitout"><i></i>Deal Me Out</label>
        </div>
        <div class="pw-row r2">
          <button class="xp-btn wide" data-a="deal" type="button"><u>D</u>eal Hand</button>
          <button class="xp-btn" data-a="fold" type="button"><u>F</u>old</button>
          <button class="xp-btn" data-a="call" type="button"><u>C</u>all</button>
          <button class="xp-btn" data-a="raise" type="button"><u>R</u>aise</button>
          <span class="amt"><span class="lbl">to</span><input class="xp-input" data-k="amt" inputmode="decimal" aria-label="Raise to (BTC)"><span class="spin"><button type="button" data-s="1" aria-label="More">▲</button><button type="button" data-s="-1" aria-label="Less">▼</button></span></span>
          <span class="presets"><button class="xp-btn mini" data-p="min" type="button">Min</button><button class="xp-btn mini" data-p="half" type="button">½ Pot</button><button class="xp-btn mini" data-p="pot" type="button">Pot</button><button class="xp-btn mini" data-p="max" type="button">Max</button></span>
          <span class="sp"></span>
          <button class="xp-btn leave" data-a="leave" type="button"><u>L</u>eave Table</button>
        </div>
        <div class="pw-row r3"><input class="xp-input log" data-k="log" readonly aria-label="Dealer"></div>
      </div>`;
    const cv = root.querySelector('canvas'), ctx = cv.getContext('2d');
    const $ = s => root.querySelector(s);
    const btn = a => root.querySelector(`[data-a="${a}"]`);
    const amtIn = $('[data-k="amt"]'), logIn = $('[data-k="log"]'), sitOut = $('[data-k="sitout"]'), msg = $('.pw-msg');
    let oddsKey = '', oddsVal = 0;
    let T = null, timers = [], disp = null, fx = [], raf = 0, uiBets = [0, 0], banner = null, think = false, lastTurnSeat = -1;

    const fmt = v => P.fmtAmt(v, DIV);
    const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };
    const later = (fn, ms) => { const id = setTimeout(fn, PREF.fast ? ms * 0.45 : ms); timers.push(id); return id; };

    function newTable(ep) {
      clearTimers(); fx = []; banner = null;
      epoch = ep;
      const saved = data.stacks[ep.id];
      T = new P.Table({ sb: ep.sb, bb: ep.bb, stack: ep.stack, youStack: saved && saved > 0 ? saved : ep.stack, level: ep.level, botName: ep.bot, you: opts.you || 'You', div: DIV });
      T.on(onEvent);
      disp = { hole: [0, 0], board: 0, reveal: false };
      uiBets = [0, 0];
      say('Welcome to the ' + ep.name + ' table. Blinds ' + fmt(ep.sb).replace(' BTC', '') + '/' + fmt(ep.bb) + '. Press Deal Hand.');
      emitState(); render(); sync();
    }
    function say(s) { logIn.value = s; }
    function emitState() { if (opts.onState) opts.onState({ epoch, stack: T.seats[0].stack, bot: T.seats[1].stack, handNo: T.handNo, fmt, stats: data.stats, history: data.history }); }

    /* ----- events from the engine ----- */
    function onEvent(ev, d) {
      if (ev === 'log') { say(d); if (opts.onLog) opts.onLog(d); return; }
      if (ev === 'deal') { disp = { hole: [0, 0], board: 0, reveal: false }; banner = null; uiBets = T.bets.slice(); SFX.chip(); }
      if (ev === 'action') {
        const k = d.kind; (k === 'fold' ? SFX.fold : k === 'check' ? SFX.check : SFX.chip)();
        flash(d.seat, k === 'fold' ? 'Fold' : k === 'check' ? 'Check' : k === 'call' ? 'Call' : k === 'allin' ? 'All-in' : k === 'bet' ? 'Bet' : 'Raise');
        uiBets = T.bets.slice();
      }
      if (ev === 'collect') {
        const from = uiBets.slice(); uiBets = [0, 0];
        from.forEach((a, i) => { if (a > 0) { const p = betPos(i); fx.push({ kind: 'chips', amt: a, x0: p.x, y0: p.y, x1: POT.x, y1: POT.y, t0: performance.now(), dur: 380 }); } });
      }
      if (ev === 'end') onEnd(d);
      if (ev === 'bust') onBust(d);
      sync(); kick();
    }
    const flashes = {};
    function flash(seat, text) { flashes[seat] = { text, t: performance.now() }; }

    function onEnd(r) {
      disp.reveal = r.showdown;
      const youWon = r.winners.includes(0) && r.winners.length === 1, split = r.winners.length === 2;
      const net = T.seats[0].stack - (data._handStart != null ? data._handStart : T.seats[0].stack);
      const st = data.stats; st.hands++; if (youWon) st.won++; else if (!split) st.lost++;
      if (r.showdown) st.showdowns++;
      if (youWon && r.pot > st.biggest) st.biggest = r.pot;
      if (T.seats[0].stack > st.best) st.best = T.seats[0].stack;
      const name = r.names ? r.names[r.winners[0]] : null;
      banner = { text: split ? 'Split pot' : youWon ? 'You win ' + fmt(r.pot) : T.seats[1].name + ' wins ' + fmt(r.pot), sub: split ? (r.names ? r.names[0] : '') : name || (r.folded >= 0 ? (r.folded === 0 ? 'You folded' : T.seats[1].name + ' folded') : ''), good: youWon || split, t: performance.now() };
      const p = youWon || split ? seatXY(0) : seatXY(1);
      fx.push({ kind: 'chips', amt: r.pot, x0: POT.x, y0: POT.y, x1: p.x, y1: p.y + (p.y > CY ? -30 : 30), t0: performance.now() + 500, dur: 520 });
      (youWon || split ? SFX.win : SFX.lose)();
      data.history.unshift({ n: T.handNo, t: Date.now(), ep: epoch.id, net, desc: (youWon ? 'Won pot' : split ? 'Split pot' : r.folded === 0 ? 'Folded' : 'Lost pot') + (name && r.showdown ? ' · ' + name : '') });
      data.history = data.history.slice(0, 40);
      data.stacks[epoch.id] = T.seats[0].stack; persist(); emitState();
      if (opts.onHand) opts.onHand({ won: youWon, split, pot: r.pot, net, fmt, handNo: T.handNo, showdown: r.showdown });
      // the bot is broke: a new block is mined
      if (T.seats[1].stack <= 0) { st.botBusts++; persist(); later(() => { T.seats[1].stack = epoch.stack; say(T.seats[1].name + ' is out of coins. A new block was mined: ' + fmt(epoch.stack) + ' generated.'); render(); }, 1400); }
      if (T.seats[0].stack <= 0) later(() => onBust(0), 1600);
      else if (!sitOut.checked && PREF.autoDeal) later(deal, 3000);
    }
    function onBust(seat) {
      if (seat !== 0) return;
      data.stats.busts++; persist();
      modal('You are out of coins.', 'Tick <b>Generate Coins</b> to mine a fresh ' + fmt(epoch.stack) + ' and sit back down. (Play money, like it was in 2009.)', [['Generate Coins', () => { T.seats[0].stack = epoch.stack; data.stacks[epoch.id] = epoch.stack; persist(); emitState(); render(); sync(); }]]);
    }
    function modal(title, html, buttons) {
      msg.innerHTML = `<div class="xp-msgbox"><div class="tb"><span class="ti">HODLEM</span></div><div class="mb-in"><div class="mb-ico">i</div><div><b>${title}</b><p>${html}</p></div></div><div class="mb-bt"></div></div>`;
      const bt = msg.querySelector('.mb-bt');
      (buttons || [['OK', null]]).forEach(([t, fn]) => { const b = el('button', 'xp-btn', t); b.type = 'button'; b.onclick = () => { msg.hidden = true; if (fn) fn(); }; bt.appendChild(b); });
      msg.hidden = false; const f = bt.querySelector('button'); if (f) f.focus();
    }

    /* ----- player actions ----- */
    function deal() {
      if (!T || !T.canDeal()) return;
      if (T.seats[0].stack <= 0) { onBust(0); return; }
      data._handStart = T.seats[0].stack; clearTimers(); fx = []; banner = null;
      T.newHand();
      if (opts.onDeal) opts.onDeal(T.handNo);
    }
    function amtUnits() { const v = parseFloat(String(amtIn.value).replace(',', '.')); return isFinite(v) ? Math.round(v * DIV) : 0; }
    function setAmt(u) { amtIn.value = P.fmtAmt(u, DIV).replace(' BTC', ''); }
    function human(kind) {
      if (!T || T.state !== 'betting' || T.toAct !== 0) return;
      const L = T.legal(0);
      if (kind === 'call') T.act(0, L.toCall === 0 ? 'check' : 'call');
      else if (kind === 'fold') T.act(0, 'fold');
      else if (kind === 'raise') { if (!L.canRaise) return; const u = amtUnits(); T.act(0, u >= L.maxTo ? 'allin' : 'raise', u); }
      else if (kind === 'allin') T.act(0, 'allin');
      clearPre();
    }
    let preSnap = null;
    function clearPre() { root.querySelectorAll('[data-pre]').forEach(c => c.checked = false); preSnap = null; }
    function tryPre() {
      if (!T || T.state !== 'betting' || T.toAct !== 0) return false;
      const on = k => root.querySelector(`[data-pre="${k}"]`).checked;
      const L = T.legal(0);
      if (on('fold')) { T.act(0, L.toCall === 0 ? 'check' : 'fold'); clearPre(); return true; }
      if (on('callany')) { T.act(0, L.toCall === 0 ? 'check' : 'call'); clearPre(); return true; }
      if (on('call')) { if (preSnap == null || preSnap === T.current) { T.act(0, L.toCall === 0 ? 'check' : 'call'); clearPre(); return true; } clearPre(); return false; }
      if (on('raiseany') && L.canRaise) { T.act(0, 'raise', L.minTo); clearPre(); return true; }
      if (on('raise') && L.canRaise) { if (preSnap == null || preSnap === T.current) { T.act(0, 'raise', L.minTo); clearPre(); return true; } clearPre(); return false; }
      return false;
    }
    root.querySelectorAll('[data-pre]').forEach(c => c.addEventListener('change', () => {
      if (c.checked) { root.querySelectorAll('[data-pre]').forEach(o => { if (o !== c) o.checked = false; }); preSnap = T ? T.current : null; }
      if (T && T.toAct === 0) tryPre();
    }));
    root.addEventListener('click', e => {
      const b = e.target.closest('button[data-a]'); if (b && !b.disabled) {
        const a = b.dataset.a;
        if (a === 'deal') deal(); else if (a === 'leave') { if (opts.onLeave) opts.onLeave(); else standUp(); } else human(a);
      }
      const p = e.target.closest('button[data-p]'); if (p && T && T.state === 'betting' && T.toAct === 0) {
        const L = T.legal(0), pot = L.pot + L.toCall;
        const to = p.dataset.p === 'min' ? L.minTo : p.dataset.p === 'max' ? L.maxTo : Math.round(T.current + (p.dataset.p === 'half' ? pot / 2 : pot));
        setAmt(Math.max(L.minTo, Math.min(L.maxTo, to)));
      }
      const sp = e.target.closest('button[data-s]'); if (sp && T && T.state === 'betting' && T.toAct === 0) {
        const L = T.legal(0); setAmt(Math.max(L.minTo, Math.min(L.maxTo, amtUnits() + Number(sp.dataset.s) * T.bb)));
      }
    });
    sitOut.addEventListener('change', () => { if (!sitOut.checked && T && T.canDeal()) later(deal, 400); sync(); });
    function standUp() {
      clearTimers();
      if (T && T.state === 'betting') { if (T.toAct === 0) T.act(0, 'fold'); }
      sitOut.checked = true; say('You stood up. Untick Deal Me Out or press Deal Hand to sit back down.'); sync();
    }
    const keyOk = () => opts.keys !== false && (compact || root.closest('.win.active') || root.matches(':hover'));
    document.addEventListener('keydown', e => {
      if (e.ctrlKey || e.metaKey) return;
      const tag = (e.target && e.target.tagName) || '';
      if ((tag === 'INPUT' && e.target !== amtIn) || tag === 'TEXTAREA') return;
      if (!keyOk()) return;
      const k = e.key.toLowerCase();
      if (e.target === amtIn && !['enter'].includes(k)) return;
      const map = { d: 'deal', f: 'fold', c: 'call', r: 'raise', l: 'leave', enter: 'raise' };
      if (!map[k]) return;
      e.preventDefault();
      const b = btn(map[k]); if (b && !b.disabled) b.click();
    });

    /* ----- bot + runout pacing ----- */
    function kick() {
      if (!T) return;
      if (T.state === 'runout') { later(() => { T.runoutStep(); sync(); kick(); }, 1000); return; }
      if (T.state !== 'betting') return;
      if (T.toAct === 1 && !think) {
        think = true; render();
        later(() => { think = false; if (T.state !== 'betting' || T.toAct !== 1) return; const d = P.botDecide(T, 1); T.act(1, d.kind, d.to); sync(); kick(); }, 650 + Math.random() * 900);
      } else if (T.toAct === 0) {
        if (lastTurnSeat !== 0) SFX.turn();
        later(() => { if (tryPre()) { sync(); kick(); } }, 250);
      }
      lastTurnSeat = T.toAct;
    }

    /* ----- controls state ----- */
    function sync() {
      if (!T) return;
      const my = T.state === 'betting' && T.toAct === 0, L = my ? T.legal(0) : null;
      btn('deal').disabled = !T.canDeal();
      btn('fold').disabled = !my;
      btn('call').disabled = !my; btn('call').innerHTML = my && L.toCall > 0 ? '<u>C</u>all ' + fmt(L.toCall).replace(' BTC', '') : '<u>C</u>heck';
      btn('raise').disabled = !(my && L.canRaise);
      btn('raise').innerHTML = my && L.canRaise ? (T.current === 0 ? '<u>B</u>et' : '<u>R</u>aise') : '<u>R</u>aise';
      if (my && L.canRaise) { const cur = amtUnits(); if (!(cur >= L.minTo && cur <= L.maxTo)) setAmt(L.minTo); amtIn.disabled = false; }
      else amtIn.disabled = !my;
      root.querySelectorAll('.presets button, .spin button').forEach(b => b.disabled = !(my && L && L.canRaise));
      if (opts.onStatus) opts.onStatus(status());
      render();
    }
    function status() {
      if (!T) return '';
      return `Hand #${T.handNo}   ·   ${epoch.name}   ·   Blinds ${fmt(epoch.sb).replace(' BTC', '')}/${fmt(epoch.bb)}${T.state === 'betting' || T.state === 'runout' ? '   ·   Pot ' + fmt(T.potTotal()) : ''}`;
    }

    /* ----- painting (the OnPaint Satoshi never wrote) ----- */
    const seatXY = i => seatPos(MAP[i]);
    const POT = { x: CX - 186, y: CY - 14 };
    function betPos(i) { const p = seatXY(i); return i === 0 ? { x: p.x + 112, y: p.y - 56 } : { x: p.x - 112, y: p.y + 56 }; }
    function fit() {
      const r = cv.getBoundingClientRect(); const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      const k = Math.min(w / W, h / H), ox = (w - W * k) / 2, oy = (h - H * k) / 2;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#030b07'; ctx.fillRect(0, 0, w, h);
      ctx.setTransform(k, 0, 0, k, ox, oy);
    }
    function render() {
      fit();
      const x = ctx, now = performance.now();
      // room
      const FC = FELTS[PREF.felt] || FELTS.green;
      const bg = x.createRadialGradient(CX, CY, 60, CX, CY, 520); bg.addColorStop(0, FC[3]); bg.addColorStop(1, '#030b07'); x.fillStyle = bg; x.fillRect(0, 0, W, H);
      // rail
      x.save(); x.shadowColor = 'rgba(0,0,0,.6)'; x.shadowBlur = 24; x.shadowOffsetY = 8;
      x.fillStyle = '#3a2412'; x.beginPath(); x.ellipse(CX, CY, RX + 24, RY + 24, 0, 0, 7); x.fill(); x.restore();
      const rail = x.createLinearGradient(0, CY - RY - 24, 0, CY + RY + 24); rail.addColorStop(0, '#7a4b22'); rail.addColorStop(0.5, '#4a2c12'); rail.addColorStop(1, '#2b180a');
      x.fillStyle = rail; x.beginPath(); x.ellipse(CX, CY, RX + 22, RY + 22, 0, 0, 7); x.fill();
      x.fillStyle = '#1a120c'; x.beginPath(); x.ellipse(CX, CY, RX + 6, RY + 6, 0, 0, 7); x.fill();
      const felt = x.createRadialGradient(CX, CY - 30, 30, CX, CY, RX); felt.addColorStop(0, FC[0]); felt.addColorStop(0.65, FC[1]); felt.addColorStop(1, FC[2]);
      x.fillStyle = felt; x.beginPath(); x.ellipse(CX, CY, RX, RY, 0, 0, 7); x.fill();
      x.strokeStyle = 'rgba(255,255,255,.12)'; x.lineWidth = 1.5; x.beginPath(); x.ellipse(CX, CY, RX - 34, RY - 30, 0, 0, 7); x.stroke();
      // felt print
      x.fillStyle = 'rgba(255,255,255,.07)'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.font = 'bold 26px Tahoma, Verdana, sans-serif'; x.fillText('HODLEM', CX - 232, CY - 4);
      x.font = '10px Tahoma, Verdana, sans-serif'; x.fillText("SATOSHI'S TABLE", CX - 232, CY + 16);
      x.font = 'bold 13px Tahoma, Verdana, sans-serif'; x.fillText('EPOCH ' + ['I', 'II', 'III', 'IV', 'V'][EPOCHS.indexOf(epoch)], CX + 232, CY - 4);
      x.font = '10px Tahoma, Verdana, sans-serif'; x.fillText('BLOCK ' + epoch.block.toLocaleString('en-US'), CX + 232, CY + 14);
      // seats
      for (let s = 0; s < SEATS; s++) {
        const p = seatPos(s), who = MAP.indexOf(s);
        if (who < 0) {
          x.fillStyle = 'rgba(0,0,0,.28)'; rr(x, p.x - 46, p.y - 13, 92, 26, 6); x.fill();
          x.fillStyle = 'rgba(255,255,255,.28)'; x.font = '10px Tahoma, Verdana, sans-serif'; x.fillText('Empty Seat', p.x, p.y + 1); continue;
        }
        const seat = T.seats[who], active = T.state === 'betting' && T.toAct === who;
        x.save();
        if (active) { x.shadowColor = 'rgba(255,200,60,.95)'; x.shadowBlur = 16; }
        x.fillStyle = who === 0 ? '#0c2a5a' : '#1b1b1b'; rr(x, p.x - 74, p.y - 22, 148, 44, 8); x.fill(); x.restore();
        x.lineWidth = 2; x.strokeStyle = active ? '#ffd24a' : 'rgba(255,255,255,.35)'; rr(x, p.x - 74, p.y - 22, 148, 44, 8); x.stroke();
        x.fillStyle = '#fff'; x.font = 'bold 12px Tahoma, Verdana, sans-serif'; x.fillText(seat.name, p.x, p.y - 8);
        x.fillStyle = '#ffd24a'; x.font = '12px Tahoma, Verdana, sans-serif'; x.fillText(T.allIn && T.allIn[who] && T.state !== 'done' ? 'ALL-IN' : fmt(seat.stack), p.x, p.y + 9);
        if (who === 1 && think) { const d = Math.floor(now / 300) % 4; x.fillStyle = 'rgba(255,255,255,.75)'; x.font = '11px Tahoma, Verdana, sans-serif'; x.fillText('thinking' + '.'.repeat(d), p.x, p.y + 34); }
        const f = flashes[who]; if (f && now - f.t < 1300) { x.globalAlpha = 1 - Math.max(0, (now - f.t - 900) / 400); x.fillStyle = '#ffd24a'; x.font = 'bold 13px Tahoma, Verdana, sans-serif'; x.fillText(f.text, p.x + (who === 0 ? 118 : -118), p.y); x.globalAlpha = 1; }
        // dealer button
        if (T.handNo > 0 && T.button === who) { const bx = p.x + (who === 0 ? -98 : 98), by = p.y; x.fillStyle = '#fff'; x.beginPath(); x.arc(bx, by, 11, 0, 7); x.fill(); x.strokeStyle = '#888'; x.lineWidth = 1; x.stroke(); x.fillStyle = '#111'; x.font = 'bold 11px Tahoma, Verdana, sans-serif'; x.fillText('D', bx, by + 1); }
      }
      // hole cards (dealt one at a time)
      const cw = 52, ch = 70;
      for (let who = 0; who < 2; who++) {
        const hc = T.hole[who] || []; const p = seatXY(who); const show = who === 0 || disp.reveal;
        const y = who === 0 ? p.y - 22 - ch - 6 : p.y + 22 + 6;
        for (let i = 0; i < Math.min(disp.hole[who], hc.length); i++) {
          const win = banner && disp.reveal && T.result && T.result.winners.length === 1 && T.result.winners[0] === who;
          drawCard(x, hc[i], p.x - cw - 2 + i * (cw + 4), y, cw, ch, show, win);
        }
      }
      // board
      const bw = 50, bh = 68, gap = 6, bx0 = CX - (5 * bw + 4 * gap) / 2, by0 = CY - bh / 2 - 6;
      for (let i = 0; i < 5; i++) { x.strokeStyle = 'rgba(255,255,255,.14)'; x.lineWidth = 1; rr(x, bx0 + i * (bw + gap), by0, bw, bh, 4); x.stroke(); }
      for (let i = 0; i < disp.board && i < T.board.length; i++) drawCard(x, T.board[i], bx0 + i * (bw + gap), by0, bw, bh, true);
      // pot + bets
      if (T.pot > 0 && T.state !== 'done') { drawChips(x, POT.x, POT.y, T.pot, T.bb); x.fillStyle = '#fff'; x.font = 'bold 11px Tahoma, Verdana, sans-serif'; x.fillText('Pot', POT.x, POT.y + 20); x.fillStyle = '#ffd24a'; x.fillText(fmt(T.pot), POT.x, POT.y + 34); }
      for (let who = 0; who < 2; who++) { const a = uiBets[who]; if (a > 0) { const p = betPos(who); drawChips(x, p.x, p.y, a, T.bb); x.fillStyle = '#fff'; x.font = 'bold 11px Tahoma, Verdana, sans-serif'; x.fillText(fmt(a), p.x, p.y + (who === 0 ? -26 : 20)); } }
      // flying chips
      fx = fx.filter(f => now < f.t0 + f.dur + 30);
      for (const f of fx) { const k = Math.max(0, Math.min(1, (now - f.t0) / f.dur)); if (k <= 0) continue; const e = 1 - Math.pow(1 - k, 3); drawChips(x, f.x0 + (f.x1 - f.x0) * e, f.y0 + (f.y1 - f.y0) * e, f.amt, T.bb); }
      // result banner
      if (banner) {
        const a = Math.min(1, (now - banner.t) / 250);
        const txt = banner.text + (banner.sub ? '  ·  ' + banner.sub : '');
        x.font = 'bold 13px Tahoma, Verdana, sans-serif'; const tw = Math.min(560, x.measureText(txt).width + 30);
        x.globalAlpha = a; x.fillStyle = 'rgba(0,0,0,.78)'; rr(x, CX - tw / 2, CY + 30, tw, 24, 6); x.fill();
        x.strokeStyle = banner.good ? '#ffd24a' : 'rgba(255,255,255,.4)'; x.lineWidth = 1.5; rr(x, CX - tw / 2, CY + 30, tw, 24, 6); x.stroke();
        x.fillStyle = banner.good ? '#ffd24a' : '#fff'; x.fillText(txt, CX, CY + 43); x.globalAlpha = 1;
      }
      // your odds (Options > Show my odds): Monte Carlo vs one random hand, recomputed per street
      if (PREF.odds && T.handNo > 0 && disp.hole[0] >= 2 && T.state !== 'done' && T.folded < 0) {
        const shown = T.board.slice(0, disp.board), key = T.handNo + ':' + T.hole[0].join(',') + ':' + shown.join(',');
        if (oddsKey !== key) { oddsKey = key; oddsVal = P.equity(T.hole[0], shown, 1200); }
        const p = seatXY(0); x.fillStyle = 'rgba(0,0,0,.55)'; rr(x, p.x - 58, p.y + 25, 116, 17, 4); x.fill();
        x.fillStyle = oddsVal >= 0.5 ? '#7f7' : '#ffd24a'; x.font = 'bold 11px Tahoma, Verdana, sans-serif'; x.fillText('Win ' + Math.round(oddsVal * 100) + '% vs random', p.x, p.y + 34);
      }
      if (T.handNo === 0) { x.fillStyle = 'rgba(255,255,255,.85)'; x.font = 'bold 14px Tahoma, Verdana, sans-serif'; x.fillText('Press Deal Hand', CX, CY); x.font = '11px Tahoma, Verdana, sans-serif'; x.fillStyle = 'rgba(255,255,255,.6)'; x.fillText('The first hand ever dealt at Satoshi’s table', CX, CY + 20); }
    }
    // animation clock: deal cards one by one, then idle at low cost
    let lastDeal = 0;
    function loop(now) {
      raf = requestAnimationFrame(loop);
      if (!T) return;
      let need = false;
      if (T.handNo > 0 && T.hole[0].length) {
        if (now - lastDeal > (PREF.fast ? 70 : 150)) {
          const order = [[T.button ^ 1, 0], [T.button, 0], [T.button ^ 1, 1], [T.button, 1]];
          for (const [s] of order) { if (disp.hole[s] < T.hole[s].length && disp.hole[s] <= Math.min(disp.hole[0], disp.hole[1])) { disp.hole[s]++; lastDeal = now; SFX.deal(); need = true; break; } }
          if (!need && disp.board < T.board.length && disp.hole[0] >= 2 && disp.hole[1] >= 2) { disp.board++; lastDeal = now; SFX.deal(); need = true; }
        }
      }
      if (need || fx.length || banner || think || Object.values(flashes).some(f => now - f.t < 1400) || (T.state === 'betting' && T.toAct >= 0)) render();
    }
    raf = requestAnimationFrame(loop);
    window.addEventListener('resize', () => render());

    newTable(epoch);
    if (opts.autoDeal) later(deal, 900);
    return {
      get table() { return T; }, EPOCHS, data,
      setEpoch(id) { const ep = EPOCHS.find(e => e.id === id); if (ep) { if (T) { data.stacks[epoch.id] = T.seats[0].stack; persist(); } newTable(ep); } },
      deal, epoch: () => epoch, status, sound(on) { data.snd = on; persist(); }, get snd() { return data.snd; },
      get prefs() { return Object.assign({}, PREF); },
      setPref(k, v) { if (!(k in PREF_DEF)) return; PREF[k] = v; persist(); if (k === 'autoDeal' && v && T && T.canDeal() && T.handNo > 0 && !sitOut.checked) later(deal, 600); render(); },
      reload() { T.seats[0].stack = epoch.stack; data.stacks[epoch.id] = epoch.stack; persist(); emitState(); render(); sync(); },
      redraw: render,
    };
  }
  window.HodlemTable = { mount, EPOCHS, DIV, data, persist, fmt: v => P.fmtAmt(v, DIV) };
})();
