/* HODLEM poker engine: heads-up No-Limit Texas Hold'em. Pure logic, no DOM.
 * Chips are integers in 0.01 BTC units (play money). Cards are 0..51: rank = c % 13 (0 = 2 ... 12 = A), suit = c / 13 | 0. */
(function (root) {
  'use strict';
  const RANKS = '23456789TJQKA', SUITS = ['s', 'h', 'd', 'c'];
  const NAMES = ['High Card', 'One Pair', 'Two Pair', 'Three of a Kind', 'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush'];
  const RANKNAME = ['Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace'];
  const PLURAL = ['Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines', 'Tens', 'Jacks', 'Queens', 'Kings', 'Aces'];

  /* ---------- randomness: crypto, unbiased ---------- */
  const cryptoObj = (typeof crypto !== 'undefined' && crypto.getRandomValues) ? crypto : null;
  const buf = new Uint32Array(1);
  function randInt(n) {
    if (!cryptoObj) return Math.floor(Math.random() * n);
    const lim = Math.floor(0x100000000 / n) * n; let x;
    do { cryptoObj.getRandomValues(buf); x = buf[0]; } while (x >= lim);
    return x % n;
  }
  const rand = () => (cryptoObj ? (cryptoObj.getRandomValues(buf), buf[0] / 0x100000000) : Math.random());
  function shuffled() { const d = []; for (let i = 0; i < 52; i++) d.push(i); for (let i = 51; i > 0; i--) { const j = randInt(i + 1); const t = d[i]; d[i] = d[j]; d[j] = t; } return d; }

  /* ---------- 7-card evaluator ---------- */
  function straightHigh(mask) {
    const ext = (mask << 1) | ((mask >> 12) & 1);
    for (let top = 12; top >= 3; top--) if (((ext >> (top - 3)) & 31) === 31) return top;
    return -1;
  }
  function pack(cat, ks) { let v = cat; for (let i = 0; i < 5; i++) v = v * 16 + (ks[i] != null ? ks[i] + 1 : 0); return v; }
  function eval7(cs) {
    const rc = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], sc = [0, 0, 0, 0], sm = [0, 0, 0, 0]; let all = 0;
    for (let i = 0; i < cs.length; i++) { const c = cs[i], r = c % 13, s = (c / 13) | 0; rc[r]++; sc[s]++; sm[s] |= 1 << r; all |= 1 << r; }
    let fs = -1; for (let s = 0; s < 4; s++) if (sc[s] >= 5) fs = s;
    if (fs >= 0) { const h = straightHigh(sm[fs]); if (h >= 0) return pack(8, [h]); }
    const q = [], t = [], p = [], s1 = [];
    for (let r = 12; r >= 0; r--) { const n = rc[r]; if (n === 4) q.push(r); else if (n === 3) t.push(r); else if (n === 2) p.push(r); else if (n === 1) s1.push(r); }
    if (q.length) { const rest = t.concat(p, s1).sort((a, b) => b - a); return pack(7, [q[0], rest[0]]); }
    if (t.length >= 2 || (t.length && p.length)) { const pr = Math.max(t[1] == null ? -1 : t[1], p[0] == null ? -1 : p[0]); return pack(6, [t[0], pr]); }
    if (fs >= 0) { const ks = []; for (let r = 12; r >= 0 && ks.length < 5; r--) if ((sm[fs] >> r) & 1) ks.push(r); return pack(5, ks); }
    const h = straightHigh(all); if (h >= 0) return pack(4, [h]);
    if (t.length) return pack(3, [t[0]].concat(s1.slice(0, 2)));
    if (p.length >= 2) { const k = p.slice(2).concat(s1).sort((a, b) => b - a)[0]; return pack(2, [p[0], p[1], k]); }
    if (p.length) return pack(1, [p[0]].concat(s1.slice(0, 3)));
    return pack(0, s1.slice(0, 5));
  }
  const category = score => Math.floor(score / 1048576);
  function describe(score) {
    const cat = category(score); const k = []; let v = score;
    for (let i = 4; i >= 0; i--) { k[i] = (v % 16) - 1; v = Math.floor(v / 16); }
    switch (cat) {
      case 8: return k[0] === 12 ? 'Royal Flush' : 'Straight Flush, ' + RANKNAME[k[0]] + ' high';
      case 7: return 'Four ' + PLURAL[k[0]];
      case 6: return 'Full House, ' + PLURAL[k[0]] + ' full of ' + PLURAL[k[1]];
      case 5: return 'Flush, ' + RANKNAME[k[0]] + ' high';
      case 4: return 'Straight, ' + RANKNAME[k[0]] + ' high';
      case 3: return 'Three ' + PLURAL[k[0]];
      case 2: return 'Two Pair, ' + PLURAL[k[0]] + ' and ' + PLURAL[k[1]];
      case 1: return 'Pair of ' + PLURAL[k[0]];
      default: return RANKNAME[k[0]] + ' High';
    }
  }
  const cardStr = c => RANKS[c % 13] + SUITS[(c / 13) | 0];

  /* ---------- equity (Monte Carlo vs one random hand) ---------- */
  function equity(hole, board, iters) {
    const used = new Uint8Array(52); hole.forEach(c => used[c] = 1); board.forEach(c => used[c] = 1);
    const rest = []; for (let i = 0; i < 52; i++) if (!used[i]) rest.push(i);
    const need = 5 - board.length; let win = 0, tie = 0;
    const me = new Array(7), op = new Array(7);
    for (let it = 0; it < iters; it++) {
      // partial shuffle of the first need+2 cards
      const n = rest.length;
      for (let i = 0; i < need + 2; i++) { const j = i + randInt(n - i); const tmp = rest[i]; rest[i] = rest[j]; rest[j] = tmp; }
      let k = 0;
      me[0] = hole[0]; me[1] = hole[1]; op[0] = rest[0]; op[1] = rest[1];
      for (let i = 0; i < board.length; i++) { me[2 + i] = board[i]; op[2 + i] = board[i]; }
      for (let i = 0; i < need; i++) { me[2 + board.length + i] = rest[2 + i]; op[2 + board.length + i] = rest[2 + i]; }
      void k;
      const a = eval7(me), b = eval7(op);
      if (a > b) win++; else if (a === b) tie++;
    }
    return (win + tie / 2) / iters;
  }

  /* ---------- the table ---------- */
  const STREETS = ['preflop', 'flop', 'turn', 'river'];
  // second person for the human seat: 'You wins' -> 'You win'
const YOU_V = { has: 'have', is: 'are', posts: 'post', folds: 'fold', checks: 'check', calls: 'call', bets: 'bet', raises: 'raise', shows: 'show', wins: 'win' };
function youify(m) { return m.replace(/\bYou (has|is|posts|folds|checks|calls|bets|raises|shows|wins)\b/g, (_, w) => 'You ' + YOU_V[w]).replace(/^(You [^]*?) and is all-in/, '$1 and are all-in').replace(/ to You$/, ' to you'); }
class Table {
    constructor(o) {
      this.sb = o.sb; this.bb = o.bb; this.start = o.stack; this.level = o.level || 1; this.div = o.div || 100;
      const div = this.div; this.fmt = v => fmtAmt(v, div);
      this.seats = [
        { name: o.you || 'You', stack: o.youStack != null ? o.youStack : o.stack, bot: false },
        { name: o.botName || '1A1zP1…DivfNa', stack: o.stack, bot: true },
      ];
      this.button = randInt(2); this.handNo = o.handNo || 0; this.listeners = []; this.log = [];
      this.state = 'idle'; this.board = []; this.hole = [[], []]; this.pot = 0; this.bets = [0, 0];
    }
    on(fn) { this.listeners.push(fn); }
    emit(ev, data) { for (const f of this.listeners) { try { f(ev, data, this); } catch (e) { if (typeof console !== 'undefined') console.error(e); } } }
    say(msg) { msg = youify(msg); this.log.push(msg); if (this.log.length > 60) this.log.shift(); this.emit('log', msg); }
    canDeal() { return this.state === 'idle' || this.state === 'done'; }
    newHand() {
      if (!this.canDeal()) return false;
      if (this.seats[0].stack <= 0 || this.seats[1].stack <= 0) { this.emit('bust', this.seats[0].stack <= 0 ? 0 : 1); return false; }
      this.handNo++; this.button ^= 1; this.deck = shuffled(); this.board = []; this.hole = [[], []];
      this.bets = [0, 0]; this.pot = 0; this.allIn = [false, false]; this.folded = -1; this.winners = null; this.result = null;
      this.street = 0; this.state = 'betting';
      const sbSeat = this.button, bbSeat = this.button ^ 1;
      this.say('Hand #' + this.handNo + ' · ' + this.seats[this.button].name + ' has the button');
      this.post(sbSeat, this.sb, 'small blind'); this.post(bbSeat, this.bb, 'big blind');
      for (let r = 0; r < 2; r++) for (const s of [sbSeat, bbSeat]) this.hole[s].push(this.deck.pop());
      this.current = Math.max(this.bets[0], this.bets[1]); this.minRaise = this.bb;
      this.acted = [false, false]; this.toAct = sbSeat;
      this.emit('deal');
      this.checkAuto();
      return true;
    }
    post(seat, amt, what) {
      const s = this.seats[seat]; const a = Math.min(amt, s.stack);
      s.stack -= a; this.bets[seat] += a; if (s.stack === 0) this.allIn[seat] = true;
      this.say(s.name + ' posts ' + what + ' ' + this.fmt(a));
    }
    potTotal() { return this.pot + this.bets[0] + this.bets[1]; }
    legal(seat = this.toAct) {
      const s = this.seats[seat], o = seat ^ 1;
      const toCall = Math.min(this.current - this.bets[seat], s.stack);
      const canRaise = !this.allIn[o] && s.stack > toCall && this.seats[o].stack > 0;
      const minTo = Math.min(this.current + this.minRaise, this.bets[seat] + s.stack);
      const maxTo = this.bets[seat] + s.stack;
      return { seat, toCall, canCheck: toCall === 0, canRaise, minTo, maxTo, pot: this.potTotal(), current: this.current };
    }
    act(seat, kind, amount) {
      if (this.state !== 'betting' || seat !== this.toAct) return false;
      const L = this.legal(seat), s = this.seats[seat], o = seat ^ 1;
      if (kind === 'fold') {
        if (L.toCall === 0) kind = 'check';
        else { this.say(s.name + ' folds'); this.folded = seat; this.acted[seat] = true; this.emit('action', { seat, kind: 'fold' }); return this.finish(); }
      }
      if (kind === 'check' || (kind === 'call' && L.toCall === 0)) {
        if (L.toCall !== 0) return false;
        this.say(s.name + ' checks'); this.acted[seat] = true; this.emit('action', { seat, kind: 'check' });
      } else if (kind === 'call') {
        const a = L.toCall; s.stack -= a; this.bets[seat] += a; if (s.stack === 0) this.allIn[seat] = true;
        this.say(s.name + ' calls ' + this.fmt(a) + (this.allIn[seat] ? ' and is all-in' : '')); this.acted[seat] = true; this.emit('action', { seat, kind: 'call', amount: a });
      } else if (kind === 'raise' || kind === 'allin') {
        if (!L.canRaise) return this.act(seat, 'call');
        let to = kind === 'allin' ? L.maxTo : Math.round(Number(amount) || 0);
        to = Math.max(L.minTo, Math.min(L.maxTo, to));
        const add = to - this.bets[seat]; const inc = to - this.current;
        s.stack -= add; this.bets[seat] = to; if (s.stack === 0) this.allIn[seat] = true;
        if (inc >= this.minRaise) this.minRaise = inc;
        const wasBet = this.current === 0 || (this.street > 0 && this.current === 0);
        this.current = Math.max(this.current, to);
        this.say(s.name + (wasBet ? ' bets ' : ' raises to ') + this.fmt(to) + (this.allIn[seat] ? ' (all-in)' : ''));
        this.acted[seat] = true; this.acted[o] = false;
        this.emit('action', { seat, kind: this.allIn[seat] ? 'allin' : (wasBet ? 'bet' : 'raise'), amount: to });
      } else return false;
      return this.advance();
    }
    advance() {
      const o = this.toAct ^ 1;
      const settled = this.bets[0] === this.bets[1] || this.allIn[0] || this.allIn[1];
      const bothActed = (this.acted[0] || this.allIn[0]) && (this.acted[1] || this.allIn[1]);
      const done = bothActed && (this.bets[0] === this.bets[1] || (this.allIn[0] && this.bets[0] <= this.bets[1]) || (this.allIn[1] && this.bets[1] <= this.bets[0]));
      void settled;
      if (!done) { this.toAct = o; this.emit('turn'); this.checkAuto(); return true; }
      // return any uncalled part of a bet
      const lo = Math.min(this.bets[0], this.bets[1]);
      for (let i = 0; i < 2; i++) if (this.bets[i] > lo) { const back = this.bets[i] - lo; this.seats[i].stack += back; this.bets[i] = lo; if (this.seats[i].stack > 0) this.allIn[i] = false; this.say(this.fmt(back) + ' returned to ' + this.seats[i].name); }
      this.pot += this.bets[0] + this.bets[1]; this.bets = [0, 0];
      this.emit('collect');
      const runout = this.allIn[0] || this.allIn[1];
      if (this.street === 3) return this.finish();
      this.street++; this.dealStreet();
      if (runout) { this.state = 'runout'; this.emit('runout'); return true; }
      this.current = 0; this.minRaise = this.bb; this.acted = [false, false];
      this.toAct = this.button ^ 1; // out of position acts first after the flop
      this.emit('street'); this.checkAuto();
      return true;
    }
    dealStreet() {
      this.deck.pop(); // burn card
      const n = this.street === 1 ? 3 : 1; for (let i = 0; i < n; i++) this.board.push(this.deck.pop());
      this.say(STREETS[this.street][0].toUpperCase() + STREETS[this.street].slice(1) + ': ' + this.board.map(cardStr).join(' '));
      this.emit('board');
    }
    // called by the UI to deal the rest of the board one street at a time when someone is all-in
    runoutStep() {
      if (this.state !== 'runout') return false;
      if (this.street >= 3) return this.finish();
      this.street++; this.dealStreet(); return true;
    }
    checkAuto() {
      if (this.state !== 'betting') return;
      // nobody can act any more: deal it out
      const L = this.legal(this.toAct);
      if (this.allIn[this.toAct] || (this.seats[this.toAct].stack === 0)) { this.acted[this.toAct] = true; this.advance(); return; }
      void L;
    }
    finish() {
      this.pot += this.bets[0] + this.bets[1]; this.bets = [0, 0];
      const pot = this.pot; let winners, hands = null;
      if (this.folded >= 0) winners = [this.folded ^ 1];
      else {
        while (this.board.length < 5) { this.deck.pop(); this.board.push(this.deck.pop()); }
        hands = [0, 1].map(i => eval7(this.hole[i].concat(this.board)));
        winners = hands[0] > hands[1] ? [0] : hands[1] > hands[0] ? [1] : [0, 1];
      }
      const share = Math.floor(pot / winners.length);
      winners.forEach(w => this.seats[w].stack += share);
      if (winners.length === 2 && pot % 2) this.seats[this.button ^ 1].stack += pot % 2; // odd chip out of position
      this.result = { winners, pot, hands, names: hands ? hands.map(describe) : null, folded: this.folded, showdown: this.folded < 0 };
      if (hands) this.say(this.seats[0].name + ' shows ' + this.hole[0].map(cardStr).join(' ') + ' (' + describe(hands[0]) + ')'), this.say(this.seats[1].name + ' shows ' + this.hole[1].map(cardStr).join(' ') + ' (' + describe(hands[1]) + ')');
      this.say(winners.length === 2 ? 'Split pot, ' + this.fmt(share) + ' each' : this.seats[winners[0]].name + ' wins ' + this.fmt(pot) + (hands ? ' with ' + describe(hands[winners[0]]) : ''));
      this.pot = 0; this.state = 'done'; this.toAct = -1;
      this.emit('end', this.result);
      return true;
    }
  }
  function fmtAmt(v, div) { const x = v / div; let s = x.toFixed(5).replace(/0+$/, ''); if (s.endsWith('.')) s += '00'; const d = (s.split('.')[1] || '').length; if (d < 2) s = x.toFixed(2); return s + ' BTC'; }
  const fmt = v => fmtAmt(v, 100);

  /* ---------- the bot ---------- */
  // level 1..5: tighter, more aggressive and less bluffy as the epochs go on
  function botDecide(t, seat) {
    const L = t.legal(seat); const lvl = t.level || 1;
    const hole = t.hole[seat], board = t.board;
    const iters = board.length === 0 ? 260 : 380;
    let eq = equity(hole, board, iters);
    const pot = L.pot, toCall = L.toCall, stack = t.seats[seat].stack;
    // respect big bets a little: opponents bet bigger with better hands
    if (toCall > 0) eq -= Math.min(0.14, 0.07 * toCall / Math.max(1, pot - toCall)) * (0.6 + lvl * 0.1);
    const aggr = 0.85 + lvl * 0.08, bluff = 0.13 - lvl * 0.015;
    const r = rand();
    const step = Math.max(1, Math.round(t.bb / 10));
    const sizeTo = frac => { const target = t.current + Math.round(Math.max(t.bb, (pot + toCall) * frac)); return Math.max(L.minTo, Math.min(L.maxTo, Math.round(target / step) * step)); };
    const shoveOk = L.maxTo <= sizeTo(1.2) * 1.15;
    if (toCall === 0) {
      if (L.canRaise && eq > 0.78 && r < 0.85 * aggr) return { kind: shoveOk && eq > 0.85 ? 'allin' : 'raise', to: sizeTo(0.75) };
      if (L.canRaise && eq > 0.6 && r < 0.65 * aggr) return { kind: 'raise', to: sizeTo(0.55 + rand() * 0.2) };
      if (L.canRaise && eq < 0.42 && r < bluff) return { kind: 'raise', to: sizeTo(0.5) };
      return { kind: 'check' };
    }
    const odds = toCall / (pot + toCall);
    if (L.canRaise && eq > 0.8 && r < 0.7 * aggr) return { kind: shoveOk ? 'allin' : 'raise', to: sizeTo(1.0) };
    if (L.canRaise && eq > 0.66 && eq > odds + 0.2 && r < 0.4 * aggr) return { kind: 'raise', to: sizeTo(0.8) };
    if (eq >= odds + 0.02 - (board.length === 0 ? 0.06 : 0)) return { kind: 'call' };
    if (L.canRaise && r < bluff * 0.4 && toCall < stack * 0.25) return { kind: 'raise', to: sizeTo(0.9) };
    // cheap peek preflop
    if (board.length === 0 && toCall <= t.bb && eq > 0.4) return { kind: 'call' };
    return { kind: 'fold' };
  }

  const API = { Table, eval7, describe, equity, cardStr, botDecide, shuffled, randInt, rand, NAMES, RANKS, SUITS, category, fmt, fmtAmt };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.Poker = API;
})(typeof window !== 'undefined' ? window : globalThis);
