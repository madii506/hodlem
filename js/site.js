/* HODLEM site: the 2009 desktop, live $HODLEM data, the burn tool. */
(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const short = a => a ? a.slice(0, 4) + '…' + a.slice(-4) : '';
  const HT = window.HodlemTable, EPOCHS = HT.EPOCHS, fmt = HT.fmt;
  const S = { cfg: {}, token: null, burns: null, mcap: 0, global: null, wallet: null };
  const open = e => !e.unlock || (S.mcap && S.mcap >= e.unlock);
  let lobbySel = 'e1';
  function toast(m, ms = 2400) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms); }
  async function api(path, body) {
    const r = await fetch('/api/' + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
    let j = null; try { j = await r.json(); } catch (e) { }
    if (!r.ok || !j || j.ok === false) { const e = new Error((j && j.error) || 'Request failed (' + r.status + ')'); e.logs = j && j.logs; throw e; }
    return j;
  }
  const compact = n => { n = Number(n); if (!isFinite(n)) return '—'; const a = Math.abs(n); return a >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : a >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : a >= 1 ? n.toFixed(2) : n.toPrecision(3); };
  const usd = n => n == null ? '—' : '$' + (n >= 1 ? compact(n) : Number(n).toPrecision(3));

  /* ---------- starfield ---------- */
  function stars(box, n) {
    if (!box) return; const suits = ['♠', '♥', '♦', '♣']; let h = '';
    for (let i = 0; i < n; i++) { const x = Math.random() * 100, y = Math.random() * 100; h += Math.random() < 0.78 ? `<i style="left:${x}%;top:${y}%;${Math.random() < 0.3 ? 'width:6px;height:6px' : ''}"></i>` : `<b style="left:${x}%;top:${y}%">${suits[i % 4]}</b>`; }
    box.innerHTML = h;
  }
  stars($('#stars1'), 46);

  /* ---------- windows: focus, drag, minimise, close, taskbar, icons ---------- */
  const desk = $('#desk'); let z = 10;
  const big = () => window.matchMedia('(min-width: 1081px)').matches;
  const WINS = $$('.win.dsk'); const wstate = {};
  WINS.forEach(w => { wstate[w.id] = w.hidden ? 'closed' : 'open'; });
  function renderTaskbar() {
    $('#tbList').innerHTML = WINS.filter(w => wstate[w.id] !== 'closed').map(w => `<button class="tb-btn ${w.classList.contains('active') && wstate[w.id] === 'open' ? 'on' : ''}" type="button" data-t="${w.id}"><img src="/img/i-${w.dataset.icon}-16.png" alt="">${esc(w.dataset.title)}</button>`).join('');
  }
  function focusWin(w) { WINS.forEach(x => x.classList.toggle('active', x === w)); w.style.zIndex = ++z; renderTaskbar(); }
  function openWin(id, quiet) {
    const w = document.getElementById(id); if (!w) return;
    w.hidden = false; wstate[id] = 'open'; focusWin(w);
    if (id === 'pokerWin' && game) game.redraw();
    if (id === 'cmdWin' && big()) setTimeout(() => $('#cmdIn').focus({ preventScroll: true }), 30);
    if (id === 'histWin') { const ta = $('#histTa'); ta.scrollTop = ta.scrollHeight; }
    if (id === 'monWin') setTimeout(drawMon, 0);
    if (id === 'optWin') syncOpts();
    if (!big() && !quiet) w.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function minWin(w) { w.hidden = true; wstate[w.id] = 'min'; w.classList.remove('active'); renderTaskbar(); }
  function closeWin(w) { w.hidden = true; wstate[w.id] = 'closed'; w.classList.remove('active'); renderTaskbar(); }
  WINS.forEach(w => {
    w.addEventListener('pointerdown', () => { if (!w.classList.contains('active')) focusWin(w); });
    const tb = $('.tb', w);
    tb.addEventListener('pointerdown', e => {
      if (!big() || e.target.closest('button')) return;
      const r = w.getBoundingClientRect(), d = desk.getBoundingClientRect(); const ox = e.clientX - r.left, oy = e.clientY - r.top;
      tb.setPointerCapture(e.pointerId);
      const mv = ev => { w.style.left = Math.max(-r.width + 80, Math.min(d.width - 80, ev.clientX - d.left - ox)) + 'px'; w.style.top = Math.max(0, Math.min(d.height - 30, ev.clientY - d.top - oy)) + 'px'; w.style.right = 'auto'; };
      const up = () => { tb.removeEventListener('pointermove', mv); tb.removeEventListener('pointerup', up); };
      tb.addEventListener('pointermove', mv); tb.addEventListener('pointerup', up);
    });
    $$('[data-w="min"]', w).forEach(b => b.addEventListener('click', () => minWin(w)));
    $$('[data-w="close"]', w).forEach(b => b.addEventListener('click', () => closeWin(w)));
  });
  $('#tbList').addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (!b) return; const w = document.getElementById(b.dataset.t); if (wstate[w.id] === 'open' && w.classList.contains('active')) minWin(w); else openWin(w.id); });
  $('#icons').addEventListener('click', e => { const b = e.target.closest('[data-open]'); if (!b) return; $$('#icons .ico').forEach(x => x.classList.toggle('sel', x === b)); if (!big() || e.detail === 0) openWin(b.dataset.open); });
  $('#icons').addEventListener('dblclick', e => { const b = e.target.closest('[data-open]'); if (b && big()) openWin(b.dataset.open); });
  const clock = () => { const d = new Date(), t = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); $('#trayClock').textContent = t; $('#pwClock').textContent = t; };
  clock(); setInterval(clock, 15000);
  $$('[data-goto]').forEach(b => b.addEventListener('click', () => { const t = document.querySelector(b.dataset.goto); if (t) t.scrollIntoView({ behavior: 'smooth' }); }));

  /* ---------- the game ---------- */
  const pwStatus = $('#pwStatus');
  let game = null;
  game = HT.mount($('#pokerMount'), {
    onStatus: s => { pwStatus.textContent = s; },
    onState: st => { $('#mfBal').textContent = fmt(st.stack).replace(' BTC', ''); renderTx(st.history); renderStats(st.stats); $('#pwTitle').textContent = 'Poker · ' + st.epoch.name; renderLobby(); },
    onHand: () => { postHand(); },
    onLeave: () => { minWin($('#pokerWin')); openWin('lobbyWin'); toast('You left the table. Pick one in the Poker Lobby.'); },
    onLog: line => { histAdd(line); cmdLog(line); },
  });
  const snd = $('#sndBtn'); const sndTxt = () => { snd.textContent = game.snd ? 'SND ON' : 'SND OFF'; const o = $('#optSnd'); if (o) o.checked = !!game.snd; }; sndTxt();
  snd.addEventListener('click', () => { game.sound(!game.snd); sndTxt(); });
  // press any key to deal (outside of inputs), first time
  let pressed = false;
  const press = e => {
    if (pressed || booting) return; const tag = (e.target && e.target.tagName) || ''; if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(tag)) return;
    if (e.type === 'keydown' && (e.ctrlKey || e.metaKey || e.key === 'Tab')) return;
    if (e.target && e.target.closest && e.target.closest('.win:not(#pokerWin), .startmenu, .top')) return;
    pressed = true;
    openWin('pokerWin', true); if (game.table && game.table.canDeal()) game.deal();
  };
  window.addEventListener('keydown', press, { once: false });
  // Generate Coins (main window) = mine a fresh stack when you're out
  $('#mfGen').addEventListener('change', e => {
    $('#mfS1').textContent = e.target.checked ? '    Generating' : '';
    if (e.target.checked && game.table && game.table.seats[0].stack < game.epoch().bb * 2 && game.table.canDeal()) { game.reload(); toast('Generated ' + fmt(game.epoch().stack) + ' of play money.'); }
  });
  $('#mfCopy').addEventListener('click', () => toast('It is play money. There is nothing to copy.'));
  $('#mfSend').addEventListener('click', () => toast('Send Coins is disabled: chips here are play money.'));
  $('#mfBook').addEventListener('click', () => openWin('bookWin'));

  function renderTx(hist) {
    const rows = (hist || []).slice(0, 30).map(h => {
      const d = new Date(h.t), ds = (d.getMonth() + 1) + '/' + d.getDate() + '/' + String(d.getFullYear()).slice(2) + ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      const ep = EPOCHS.find(e => e.id === h.ep) || EPOCHS[0];
      const amt = h.net ? fmt(Math.abs(h.net)).replace(' BTC', '') : '';
      return `<tr><td class="st">${h.net > 0 ? 'Won' : h.net < 0 ? 'Lost' : 'Even'}</td><td>${ds}</td><td>Hand #${h.n} · ${esc(ep.name)} · ${esc(h.desc)}</td><td class="r db">${h.net < 0 ? amt : ''}</td><td class="r cr">${h.net > 0 ? amt : ''}</td></tr>`;
    }).join('');
    $('#mfTx').innerHTML = rows || '<tr><td colspan="5">No transactions yet. Deal a hand.</td></tr>';
    $('#mfS2').textContent = `     1 connections     ${(S.global != null ? S.global : 0).toLocaleString('en-US')} hands     ${(hist || []).length} transactions`;
  }
  function renderStats(st) {
    $('#sHands').textContent = st.hands.toLocaleString('en-US'); $('#sWon').textContent = st.won.toLocaleString('en-US');
    $('#sBig').textContent = st.biggest ? fmt(st.biggest) : '—'; $('#sBest').textContent = st.best ? fmt(st.best) : '—';
    $('#sShow').textContent = st.showdowns; $('#sBust').textContent = st.busts; $('#sBot').textContent = st.botBusts;
    $('#trayHands').textContent = st.hands + ' hands';
  }
  async function postHand() { try { const j = await api('hands', {}); if (j.count != null) { S.global = j.count; $('#sGlobal').textContent = j.count.toLocaleString('en-US'); webHands(j.count); } } catch (e) { } }
  async function getHands() { try { const r = await fetch('/api/hands'); const j = await r.json(); if (j.count != null) { S.global = j.count; $('#sGlobal').textContent = j.count.toLocaleString('en-US'); webHands(j.count); } else { $('#sGlobal').textContent = 'offline'; webHands(null); } renderStatus(); } catch (e) { $('#sGlobal').textContent = 'offline'; webHands(null); } }

  /* ---------- lobby + epochs ---------- */
  function renderLobby() {
    const cur = game && game.epoch ? game.epoch().id : 'e1';
    $('#lbTree').innerHTML = `<div class="t1 tw">Poker</div><div class="t2 tw">Texas Hold'em</div><div class="t3 sel">No Limit</div><div class="t3">Heads-up</div>`;
    $('#lbRows').innerHTML = EPOCHS.map(e => `<tr data-ep="${e.id}" class="${e.id === lobbySel ? 'sel' : ''} ${open(e) ? '' : 'dis'}"><td>${esc(e.name)}${e.id === cur ? ' ◄' : ''}</td><td>${e.block.toLocaleString('en-US')}</td><td>${fmt(e.sb).replace(' BTC', '')}/${fmt(e.bb).replace(' BTC', '')}</td><td>${e.id === cur ? '2/10' : '1/10'}</td><td>${open(e) ? 'Open' : 'Opens at $' + compact(e.unlock) + ' mcap'}</td></tr>`).join('');
    renderEpochs();
  }
  $('#lbRows').addEventListener('click', e => { const tr = e.target.closest('tr[data-ep]'); if (!tr) return; lobbySel = tr.dataset.ep; renderLobby(); });
  $('#lbRows').addEventListener('dblclick', e => { const tr = e.target.closest('tr[data-ep]'); if (tr) sit(tr.dataset.ep); });
  $('#lbOpen').addEventListener('click', () => sit(lobbySel));
  function sit(id) {
    const ep = EPOCHS.find(x => x.id === id); if (!ep) return;
    if (!open(ep)) { toast(ep.name + ' opens at $' + compact(ep.unlock) + ' market cap.'); return; }
    game.setEpoch(id); openWin('pokerWin'); game.redraw(); cmdPrint('<u>Sat down at the ' + esc(ep.name) + ' table.</u>');
  }
  function renderEpochs() {
    const roman = ['I', 'II', 'III', 'IV', 'V'];
    $('#epochs').innerHTML = EPOCHS.map((e, i) => {
      const o = open(e), pct = e.unlock ? Math.min(100, (S.mcap || 0) / e.unlock * 100) : 100;
      return `<div class="ep ${o ? '' : 'locked'}"><span class="n">EPOCH ${roman[i]}</span><h3>${esc(e.name)}</h3>
        <p>Block ${e.block.toLocaleString('en-US')} · ${e.date}</p><p>Stack ${fmt(e.stack)} · blinds ${fmt(e.sb).replace(' BTC', '')}/${fmt(e.bb).replace(' BTC', '')}</p><p>Bot level ${e.level} of 5</p>
        ${e.unlock ? `<p>${o ? 'Unlocked' : 'Opens at $' + compact(e.unlock) + ' mcap'}</p><div class="mini-bar"><i style="width:${pct.toFixed(1)}%"></i></div>` : '<p>Open from launch</p>'}
        <button class="pbtn" type="button" data-sit="${e.id}">${o ? 'SIT DOWN' : 'LOCKED'}</button></div>`;
    }).join('');
  }
  $('#epochs').addEventListener('click', e => { const b = e.target.closest('[data-sit]'); if (!b) return; const ep = EPOCHS.find(x => x.id === b.dataset.sit); if (!open(ep)) { toast('Opens at $' + compact(ep.unlock) + ' market cap.'); return; } sit(ep.id); document.getElementById('play').scrollIntoView({ behavior: 'smooth' }); });

  /* ---------- X card demo + share ---------- */
  $('#cardPlay').addEventListener('click', () => { $('#cardx').innerHTML = '<iframe src="/play" title="HODLEM inside a post" loading="lazy" allow="autoplay"></iframe>'; });
  const link = location.origin + '/';
  $('#shareX').href = 'https://x.com/intent/post?text=' + encodeURIComponent("Satoshi put a poker table in Bitcoin's first code and never dealt a hand. I just played it. ") + '&url=' + encodeURIComponent(link);
  $('#copyLink').addEventListener('click', () => { navigator.clipboard && navigator.clipboard.writeText(link).then(() => toast('Link copied. Paste it in a post and it becomes the table.')); });

  /* ---------- config + token + burns ---------- */
  async function loadConfig() {
    try {
      S.cfg = await api('config');
      const xh = S.cfg.x ? (String(S.cfg.x).startsWith('http') ? S.cfg.x : 'https://x.com/' + String(S.cfg.x).replace(/^@/, '')) : '';
      if (xh) $('#xHandle').textContent = '@' + xh.split('/').pop();
      if (S.cfg.ca) {
        $('#caPill').hidden = false; $('#caShort').textContent = short(S.cfg.ca);
        $('#caPill').onclick = () => navigator.clipboard && navigator.clipboard.writeText(S.cfg.ca).then(() => toast('Contract address copied'));
        $('#buyTop').href = 'https://pump.fun/coin/' + S.cfg.ca; $('#buyTop').target = '_blank'; $('#buyTop').rel = 'noopener';
        $('#tokLinks').innerHTML = `<a class="pbtn orange" href="https://pump.fun/coin/${esc(S.cfg.ca)}" target="_blank" rel="noopener">BUY ON PUMP.FUN</a><a class="pbtn ghost" href="https://dexscreener.com/solana/${esc(S.cfg.ca)}" target="_blank" rel="noopener">CHART</a><a class="pbtn ghost" href="https://solscan.io/token/${esc(S.cfg.ca)}" target="_blank" rel="noopener">SOLSCAN</a>${xh ? `<a class="pbtn ghost" href="${esc(xh)}" target="_blank" rel="noopener">X</a>` : ''}<button class="pbtn ghost" type="button" id="caCopy2">COPY CA</button>`;
        $('#caCopy2').onclick = () => navigator.clipboard && navigator.clipboard.writeText(S.cfg.ca).then(() => toast('Contract address copied'));
        $('#tokNote').innerHTML = 'CA <code>' + esc(S.cfg.ca) + '</code>'; $('#wBuy').href = 'https://pump.fun/coin/' + S.cfg.ca; $('#wBuy').target = '_blank';
      } else {
        $('#tokLinks').innerHTML = '<span class="pbtn ghost">CA AT LAUNCH</span>';
        $('#bStatus').textContent = 'Burns appear here once $HODLEM is live.'; $('#bRows').innerHTML = '<tr><td colspan="3">No burns yet. $HODLEM has not launched.</td></tr>';
        $('#wLabel').textContent = 'Opens at launch'; renderBin([], null);
      }
      $('#footLinks').innerHTML = (xh ? `<a href="${esc(xh)}" target="_blank" rel="noopener">X</a>` : '') + (S.cfg.ca ? `<a href="https://dexscreener.com/solana/${esc(S.cfg.ca)}" target="_blank" rel="noopener">CHART</a>` : '') + '<a href="#proof">PROOF</a><a href="#burn">BURN</a><a href="#faq">FAQ</a>';
    } catch (e) { S.cfg = {}; }
    renderBook(); renderStatus();
  }
  async function loadToken() {
    if (!S.cfg.ca) return;
    try {
      const { token: t } = await api('token'); S.token = t;
      const d = 10 ** t.decimals; const m = t.market;
      $('#tPrice').textContent = m && m.priceUsd ? usd(m.priceUsd) : '—';
      $('#tMcap').textContent = m && m.mcap ? usd(m.mcap) : '—';
      $('#tVol').textContent = m && m.vol24 != null ? usd(m.vol24) : '—';
      $('#tSupply').textContent = compact(Number(t.supply) / d);
      $('#bBurned').textContent = compact(Number(t.burned) / d);
      $('#bPct').textContent = t.burnedPct.toFixed(t.burnedPct < 1 ? 3 : 2) + '%';
      $('#burnBar').style.width = Math.min(100, t.burnedPct * 10) + '%';
      $('#bFees').textContent = t.fees ? t.fees.totalSol.toFixed(4) : '—';
      $('#wPrice').textContent = m && m.priceUsd ? usd(m.priceUsd) : '—'; $('#wMcap').textContent = m && m.mcap ? usd(m.mcap) : '—';
      $('#wBurn').textContent = compact(Number(t.burned) / d) + ' (' + t.burnedPct.toFixed(2) + '%)'; $('#wFees').textContent = t.fees ? t.fees.totalSol.toFixed(4) + ' SOL' : '—';
      if (S.lastMcap && m && m.mcap && Math.abs(m.mcap - S.lastMcap) / S.lastMcap > 0.02) cmdPrint('<u>$HODLEM mcap ' + usd(m.mcap) + '</u>'); S.lastMcap = m && m.mcap;
      S.mcap = m && m.mcap ? m.mcap : 0; renderLobby();
      if (t.curve) { $('#curveBox').hidden = false; $('#curveTxt').textContent = (t.curve.progress * 100).toFixed(1) + '% of the bonding curve sold · ' + t.curve.realSol.toFixed(2) + ' SOL in the curve'; $('#curveBar').style.width = (t.curve.progress * 100).toFixed(1) + '%'; }
      else $('#curveBox').hidden = true;
      monSample(t); renderCalc(); renderStatus();
    } catch (e) { $('#tokNote').textContent = 'Chain data is offline right now. Retrying.'; S.tokErr = true; renderStatus(); $('#monS0').textContent = 'Chain data offline · retrying'; }
  }
  async function loadBurns() {
    if (!S.cfg.ca) return;
    try {
      const j = await api('burns'); const prev = S.burns ? S.burns.length : null; S.burns = j.list || [];
      renderBin(S.burns, S.token); if (prev != null && S.burns.length > prev) cmdPrint('<i>New burn on-chain: ' + compact(Number(S.burns[0].amount) / 10 ** ((S.token && S.token.decimals) || 6)) + ' $HODLEM</i>');
      const d = 10 ** ((S.token && S.token.decimals) || 6);
      $('#bCount').textContent = S.burns.length; renderStatus();
      $('#bRows').innerHTML = S.burns.length ? S.burns.map(b => `<tr><td>${b.t ? new Date(b.t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</td><td class="r">${compact(Number(b.amount) / d)}</td><td><a href="https://solscan.io/tx/${esc(b.sig)}" target="_blank" rel="noopener">${short(b.sig)}</a></td></tr>`).join('') : '<tr><td colspan="3">No burns yet. The first one lands here.</td></tr>';
      $('#bStatus').textContent = j.wallets && j.wallets.length ? 'Watching ' + j.wallets.map(short).join(', ') + ' · total burned counts every burn' : 'Set HODLEM_CREATOR to list burns';
    } catch (e) { $('#bStatus').textContent = 'Burn list offline right now. Retrying.'; }
  }

  /* ---------- wallet (Wallet Standard) ---------- */
  const W = { list: [], w: null, acct: null };
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const b58 = bytes => { let n = 0n; for (const x of bytes) n = n * 256n + BigInt(x); let s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; } for (const x of bytes) { if (x === 0) s = '1' + s; else break; } return s; };
  const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const toB64 = u => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  function addWallet(w) {
    try {
      if (!w || !w.features || !w.name) return;
      const sol = (w.chains || []).some(c => String(c).startsWith('solana:'));
      const can = w.features['standard:connect'] && (w.features['solana:signTransaction'] || w.features['solana:signAndSendTransaction']);
      if (!sol || !can || W.list.some(x => x.name === w.name)) return;
      W.list.push(w); if (!$('#wModal').hidden) renderWallets();
    } catch (e) { }
  }
  const walletApi = Object.freeze({ register: (...ws) => { ws.forEach(addWallet); return () => { }; } });
  window.addEventListener('wallet-standard:register-wallet', e => { try { e.detail(walletApi); } catch (_) { } });
  try { window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: walletApi })); } catch (_) { }
  function renderWallets() {
    const box = $('#wList');
    if (!W.list.length) { box.innerHTML = '<p>No Solana wallet found in this browser.</p><a class="xp-btn wopt" href="https://phantom.com/download" target="_blank" rel="noopener">Get Phantom</a><a class="xp-btn wopt" href="https://solflare.com/download" target="_blank" rel="noopener">Get Solflare</a>'; return; }
    box.innerHTML = W.list.map((w, i) => `<button class="xp-btn wopt" data-i="${i}" type="button">${w.icon ? `<img src="${esc(w.icon)}" alt="">` : ''}${esc(w.name)}</button>`).join('');
  }
  $('#wList').addEventListener('click', async e => {
    const b = e.target.closest('button[data-i]'); if (!b) return; const w = W.list[+b.dataset.i];
    try { const r = await w.features['standard:connect'].connect(); const a = (r && r.accounts && r.accounts[0]) || (w.accounts && w.accounts[0]); if (!a) throw new Error('No account shared'); W.w = w; W.acct = a; $('#wModal').hidden = true; $('#wBtn').textContent = short(a.address); $('#wLabel').textContent = w.name; loadWallet(); }
    catch (err) { toast(err && err.message ? err.message : 'Connection cancelled'); }
  });
  $('#wClose').addEventListener('click', () => { $('#wModal').hidden = true; });
  $('#wBtn').addEventListener('click', () => { if (!S.cfg.ca) { toast('The burn opens when $HODLEM launches.'); return; } renderWallets(); $('#wModal').hidden = false; });
  async function loadWallet() {
    if (!W.acct || !S.cfg.ca) return;
    try {
      const { wallet: w } = await api('wallet?user=' + W.acct.address); S.wallet = w;
      $('#wSol').textContent = w.sol.toFixed(4); $('#wTok').textContent = compact(Number(w.hodlem) / 10 ** w.decimals);
      $('#wClaim').textContent = (w.isCreator || w.share != null) ? w.claimSol.toFixed(4) + ' SOL' : 'not the creator';
      const cl = $('#bClaim'); cl.disabled = !(w.claimSol > 0.001); if (cl.disabled) cl.checked = false; else cl.checked = true;
      quote();
    } catch (e) { toast(e.message); }
  }
  function quote() {
    const add = parseFloat(($('#bSol').value || '0').replace(',', '.')) || 0, claim = $('#bClaim').checked && S.wallet ? S.wallet.claimSol : 0;
    $('#bQuote').textContent = add + claim > 0 ? 'Spends ' + (add + claim).toFixed(4) + ' SOL on $HODLEM, then burns it' : '';
  }
  $('#bSol').addEventListener('input', quote); $('#bClaim').addEventListener('change', quote);
  async function waitFor(sig) {
    const t0 = Date.now();
    while (Date.now() - t0 < 90000) {
      await new Promise(r => setTimeout(r, 1400));
      try { const s = await api('status?sig=' + sig); if (s.err) throw Object.assign(new Error('The transaction failed on-chain.'), { chain: 1 }); if (s.status === 'confirmed' || s.status === 'finalized') return; } catch (e) { if (e.chain) throw e; }
    }
    throw new Error('Not confirmed after 90 seconds. Check Solscan before trying again.');
  }
  $('#bGo').addEventListener('click', async () => {
    if (!S.cfg.ca) { toast('The burn opens when $HODLEM launches.'); return; }
    if (!W.w) { renderWallets(); $('#wModal').hidden = false; return; }
    const st = $('#bSt'), btn = $('#bGo'); const show = (cls, h) => { st.className = 'bw-st sunken show ' + cls; st.innerHTML = h; };
    const add = parseFloat(($('#bSol').value || '0').replace(',', '.')) || 0, claim = $('#bClaim').checked;
    if (!claim && add < 0.001) { toast('Enter at least 0.001 SOL, or tick Claim.'); return; }
    btn.disabled = true;
    try {
      show('', 'Building and simulating…');
      const r = await api('tx', { user: W.acct.address, sol: add, claim, slippage: +$('#bSlip').value });
      const q = r.quote, d = 10 ** q.decimals;
      show('', `Approve in your wallet: spend ${q.spendSol.toFixed(4)} SOL${q.claimSol ? ' (' + q.claimSol.toFixed(4) + ' from fees)' : ''}, buy and burn ${compact(Number(q.tokens) / d)} $HODLEM.`);
      const f = W.w.features, chain = 'solana:mainnet', bytes = fromB64(r.txs[0].tx); let sig;
      if (f['solana:signAndSendTransaction']) { const [o] = await f['solana:signAndSendTransaction'].signAndSendTransaction({ account: W.acct, chain, transaction: bytes, options: { commitment: 'confirmed' } }); sig = typeof o.signature === 'string' ? o.signature : b58(o.signature); }
      else { const [o] = await f['solana:signTransaction'].signTransaction({ account: W.acct, chain, transaction: bytes }); sig = (await api('send', { tx: toB64(o.signedTransaction) })).sig; }
      show('', `Confirming… <a href="https://solscan.io/tx/${sig}" target="_blank" rel="noopener">View on Solscan</a>`);
      await waitFor(sig);
      show('ok', `Burned ${compact(Number(q.tokens) / d)} $HODLEM. <a href="https://solscan.io/tx/${sig}" target="_blank" rel="noopener">View on Solscan</a>`);
      toast('Burned.'); setTimeout(() => { loadToken(); loadBurns(); loadWallet(); }, 2500);
    } catch (e) {
      show('err', esc(/reject|denied|cancel/i.test(e.message || '') ? 'You cancelled in the wallet. Nothing was sent.' : e.message) + (e.logs ? '<pre style="white-space:pre-wrap;font-size:10px">' + esc(e.logs.join('\n')) + '</pre>' : ''));
    } finally { btn.disabled = false; }
  });

  /* ---------- Hand History.txt (real log of this session) ---------- */
  const histLines = [];
  function histAdd(line) {
    const d = new Date(); const ts = d.toLocaleTimeString('en-US', { hour12: false });
    if (/^Hand #/.test(line)) histLines.push('');
    histLines.push('[' + ts + '] ' + line); if (histLines.length > 500) histLines.splice(0, histLines.length - 500);
    const ta = $('#histTa'); if (!ta) return; ta.value = 'HODLEM hand history · this session · play money\r\n' + histLines.join('\r\n'); ta.scrollTop = ta.scrollHeight;
  }

  /* ---------- Command Prompt: live log + commands ---------- */
  const cmdOut = $('#cmdOut'), cmdIn = $('#cmdIn');
  function cmdPrint(html) { if (!cmdOut) return; cmdOut.insertAdjacentHTML('beforeend', html + '\n'); const lines = cmdOut.innerHTML.split('\n'); if (lines.length > 300) cmdOut.innerHTML = lines.slice(-300).join('\n'); cmdOut.scrollTop = cmdOut.scrollHeight; }
  function cmdLog(line) {
    if (/^Hand #/.test(line)) cmdPrint('<b>' + esc(line) + '</b>');
    else if (/ wins? | Split pot|returned to/.test(line)) cmdPrint('<i>' + esc(line) + '</i>');
    else if (/^(Flop|Turn|River):/.test(line)) cmdPrint('  ' + esc(line));
  }
  const CMDS = {
    help: () => cmdPrint('Commands:\n  DEAL  FOLD  CALL  CHECK  RAISE [btc]  ALLIN\n  STATS  TABLES  SIT [1-5]  CA  BURN  PROOF  X\n  MONITOR  CALC  ADDR  BIN  RULES  OPTIONS  ABOUT\n  SND  DIR  VER  DATE  CLS  EXIT'),
    ver: () => cmdPrint('HODLEM [Version 0.1.2009]\nThe poker table from Bitcoin v0.1, finished. Play money only.'),
    date: () => cmdPrint('The current date is: ' + new Date().toDateString()),
    cls: () => { cmdOut.innerHTML = ''; },
    dir: () => cmdPrint(' Directory of C:\\HODLEM\n\n  uibase.h            CPokerLobbyDialogBase, CPokerDialogBase\n  Bitcoin.exe         Balance = your play stack\n  Poker Lobby.exe     five tables, one per halving\n  Poker.exe           heads-up No-Limit Hold\'em\n  hodlem.htm          the coin\'s homepage\n  Burn Bin            every burn, read from the chain\n  readme.txt'),
    deal: () => { openWin('pokerWin', true); if (game.table && game.table.canDeal()) { game.deal(); cmdPrint('Dealing…'); } else cmdPrint('A hand is already in progress.'); },
    fold: () => act('fold'), call: () => act('call'), check: () => act('call'), allin: () => act('allin'),
    raise: a => { const v = parseFloat(a); if (isFinite(v)) { const inp = $('#pokerMount [data-k="amt"]'); if (inp) inp.value = v; } act('raise'); },
    stats: () => { const st = HT.data.stats; cmdPrint(`Hands ${st.hands} · won ${st.won} · lost ${st.lost} · showdowns ${st.showdowns}\nBiggest pot ${st.biggest ? fmt(st.biggest) : '-'} · best stack ${st.best ? fmt(st.best) : '-'} · busts ${st.busts} · bots busted ${st.botBusts}\nHands dealt worldwide: ${S.global != null ? S.global.toLocaleString('en-US') : 'offline'}`); },
    tables: () => cmdPrint(EPOCHS.map((e, i) => `  ${i + 1}  ${e.name.padEnd(16)} block ${String(e.block).padEnd(7)} ${open(e) ? 'OPEN' : 'opens at $' + compact(e.unlock)}`).join('\n')),
    sit: n => { const e = EPOCHS[(parseInt(n, 10) || 1) - 1]; if (!e) return cmdPrint('Usage: SIT 1-5'); sit(e.id); },
    ca: () => { if (!S.cfg.ca) return cmdPrint('$HODLEM has not launched yet. The CA appears here at launch.'); cmdPrint(S.cfg.ca); navigator.clipboard && navigator.clipboard.writeText(S.cfg.ca).then(() => cmdPrint('        1 file(s) copied.')); },
    burn: () => { const t = S.token; if (!t) return cmdPrint('Burn data is live after launch. 100% of creator fees buy back $HODLEM and burn it.'); cmdPrint(`Burned ${compact(Number(t.burned) / 10 ** t.decimals)} $HODLEM (${t.burnedPct.toFixed(3)}% of supply) · fees waiting ${t.fees ? t.fees.totalSol.toFixed(4) : '-'} SOL`); },
    proof: () => { cmdPrint('Opening uibase.h…'); document.getElementById('proof').scrollIntoView({ behavior: 'smooth' }); },
    x: () => { cmdPrint('Opening the X card…'); document.getElementById('x').scrollIntoView({ behavior: 'smooth' }); },
    snd: () => { game.sound(!game.snd); sndTxt(); cmdPrint('Sound ' + (game.snd ? 'on' : 'off') + '.'); },
    exit: () => closeWin($('#cmdWin')),
    monitor: () => openWin('monWin'), calc: () => openWin('calcWin'), addr: () => openWin('bookWin'), options: () => openWin('optWin'),
    about: () => openWin('aboutWin'), rules: () => openWin('helpWin'), bin: () => openWin('binWin'), start: () => toggleStart(true),
  };
  function act(kind) { const b = $(`#pokerMount [data-a="${kind === 'allin' ? 'raise' : kind}"]`); if (kind === 'allin') { const L = game.table && game.table.state === 'betting' && game.table.toAct === 0 ? game.table.legal(0) : null; if (L) { const inp = $('#pokerMount [data-k="amt"]'); inp.value = (L.maxTo / HT.DIV); } } if (b && !b.disabled) b.click(); else cmdPrint('Not your turn.'); }
  if (cmdIn) {
    cmdIn.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key !== 'Enter') return;
      const raw = cmdIn.value.trim(); cmdIn.value = ''; cmdPrint('C:\\HODLEM&gt;' + esc(raw)); if (!raw) return;
      const [c, ...args] = raw.split(/\s+/); const f = CMDS[c.toLowerCase()];
      if (f) f(args.join(' ')); else cmdPrint(`'${esc(c)}' is not recognized as an internal or external command.\nType HELP for a list.`);
    });
    $('#cmd').addEventListener('click', () => { if (!getSelection().toString()) cmdIn.focus({ preventScroll: true }); });
  }

  /* ---------- web page + bin ---------- */
  $('#wDate').textContent = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  $('#wbRefresh').addEventListener('click', () => { $('#wbStatus').textContent = 'Opening page http://hodlem/index.htm...'; loadToken().then(() => { $('#wbStatus').textContent = 'Done'; }); });
  $('#wbStop').addEventListener('click', () => { $('#wbStatus').textContent = 'Done'; });
  $('#wbHome').addEventListener('click', () => { $('#wbPage').scrollTop = 0; });
  $('#wbGo').addEventListener('click', () => { $('#wbPage').scrollTop = 0; });
  function webHands(n) { const el = $('#wHands'); if (!el) return; el.textContent = n == null ? 'offline' : String(n).padStart(7, '0'); }
  function renderBin(list, t) {
    const box = $('#binList'); if (!box) return;
    const d = 10 ** ((t && t.decimals) || 6);
    box.innerHTML = list && list.length ? list.map(b => `<a class="it" href="https://solscan.io/tx/${esc(b.sig)}" target="_blank" rel="noopener"><img src="/img/i-bin.png" alt=""><span>${compact(Number(b.amount) / d)} $HODLEM</span><small>${b.t ? new Date(b.t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</small></a>`).join('') : `<div class="bin-empty">${S.cfg.ca ? 'The bin is empty. The first burn lands here.' : 'The bin opens when $HODLEM launches.'}</div>`;
    $('#binStatus').textContent = (list ? list.length : 0) + ' object(s)' + (t ? ' · ' + compact(Number(t.burned) / d) + ' $HODLEM burned in total' : '');
    $('#binDet').innerHTML = t ? `Burned: <b>${compact(Number(t.burned) / d)}</b><br>Of supply: <b>${t.burnedPct.toFixed(3)}%</b><br>Fees waiting: <b>${t.fees ? t.fees.totalSol.toFixed(4) + ' SOL' : '-'}</b>` : 'No data before launch.';
  }


  /* ---------- Start menu, data-open links, Show Desktop, Turn Off ---------- */
  const startBtn = $('#startBtn'), startMenu = $('#startMenu');
  function toggleStart(on) { const v = on == null ? startMenu.hidden : on; startMenu.hidden = !v; startBtn.setAttribute('aria-expanded', String(v)); }
  startBtn.addEventListener('click', e => { e.stopPropagation(); toggleStart(); });
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-open]');
    if (b && !b.closest('#icons')) { e.preventDefault(); openWin(b.dataset.open); toggleStart(false); return; }
    if (!startMenu.hidden && !e.target.closest('#startMenu')) toggleStart(false);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !startMenu.hidden) toggleStart(false); });
  $('#smShow').addEventListener('click', () => { WINS.forEach(w => { if (wstate[w.id] === 'open') minWin(w); }); toggleStart(false); });
  $('#smOff').addEventListener('click', () => { toggleStart(false); $('#offScreen').hidden = false; });
  $('#offScreen').addEventListener('click', () => { $('#offScreen').hidden = true; });

  /* ---------- Options (table preferences, saved in this browser) ---------- */
  function syncOpts() { const pr = game.prefs; $$('#optWin [data-pref]').forEach(el => { const v = pr[el.dataset.pref]; if (el.type === 'checkbox') el.checked = !!v; else el.value = v; }); $('#optSnd').checked = !!game.snd; }
  $$('#optWin [data-pref]').forEach(el => el.addEventListener('change', () => { game.setPref(el.dataset.pref, el.type === 'checkbox' ? el.checked : el.value); cmdPrint('Options: ' + el.dataset.pref + ' = ' + (el.type === 'checkbox' ? (el.checked ? 'on' : 'off') : el.value)); }));
  $('#optSnd').addEventListener('change', e => { game.sound(e.target.checked); sndTxt(); });
  let resetArm = 0;
  $('#optReset').addEventListener('click', e => {
    if (Date.now() - resetArm > 4000) { resetArm = Date.now(); e.target.textContent = 'Click again to reset'; setTimeout(() => { e.target.textContent = 'Reset everything…'; }, 4000); return; }
    try { localStorage.removeItem('hodlem:v1'); } catch (_) { } location.reload();
  });
  syncOpts();

  /* ---------- Address Book: the real addresses, nothing invented ---------- */
  let bookSel = 0, bookRows = [];
  function renderBook() {
    const c = S.cfg || {};
    bookRows = [
      { n: '$HODLEM token (CA)', a: c.ca, u: c.ca && 'https://solscan.io/token/' + c.ca, none: 'Not launched yet' },
      { n: 'Creator wallet (fees in)', a: c.creator, u: c.creator && 'https://solscan.io/account/' + c.creator, none: 'Set at launch' },
      ...(c.burners || []).map((b, i) => ({ n: 'Burn wallet ' + (i + 1), a: b, u: 'https://solscan.io/account/' + b })),
      { n: 'pump.fun program', a: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', u: 'https://solscan.io/account/6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P' },
      { n: 'PumpSwap program', a: 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA', u: 'https://solscan.io/account/pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA' },
      { n: 'Genesis reward (Bitcoin, 2009)', a: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', u: 'https://mempool.space/address/1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa' },
    ];
    bookSel = Math.min(bookSel, bookRows.length - 1);
    $('#bkRows').innerHTML = bookRows.map((r, i) => `<tr data-i="${i}" class="${i === bookSel ? 'sel' : ''} ${r.a ? '' : 'dis'}"><td>${esc(r.n)}</td><td>${r.a ? esc(r.a) : esc(r.none || '—')}</td></tr>`).join('');
  }
  $('#bkRows').addEventListener('click', e => { const tr = e.target.closest('tr[data-i]'); if (tr) { bookSel = +tr.dataset.i; renderBook(); } });
  $('#bkRows').addEventListener('dblclick', e => { const tr = e.target.closest('tr[data-i]'); if (tr) { bookSel = +tr.dataset.i; $('#bkView').click(); } });
  $('#bkCopy').addEventListener('click', () => { const r = bookRows[bookSel]; if (!r || !r.a) return toast('Nothing to copy yet.'); navigator.clipboard && navigator.clipboard.writeText(r.a).then(() => toast(r.n + ' copied')); });
  $('#bkView').addEventListener('click', () => { const r = bookRows[bookSel]; if (!r || !r.u) return toast('Nothing to view yet.'); window.open(r.u, '_blank', 'noopener'); });

  /* ---------- Poker Help ---------- */
  const mc = (r, s) => `<span class="mc ${s === '♥' || s === '♦' ? 'r' : ''}">${r}<i>${s}</i></span>`;
  const hand = str => str.split(' ').map(c => mc(c.slice(0, -1), c.slice(-1))).join('');
  const HELP = {
    rank: ['Hand Rankings', `<h3>Hand Rankings</h3><p>Best five cards out of your two and the five on the board. Highest first.</p><table class="rk">
      ${[['1', 'Royal Flush', 'A♠ K♠ Q♠ J♠ 10♠', 'A to 10, one suit.'], ['2', 'Straight Flush', '9♥ 8♥ 7♥ 6♥ 5♥', 'Five in a row, one suit.'], ['3', 'Four of a Kind', 'Q♣ Q♦ Q♥ Q♠ 4♦', 'Four of one rank.'], ['4', 'Full House', 'J♠ J♥ J♦ 8♣ 8♠', 'Three of a kind plus a pair.'], ['5', 'Flush', 'A♦ J♦ 9♦ 6♦ 2♦', 'Five of one suit.'], ['6', 'Straight', '10♣ 9♦ 8♠ 7♥ 6♣', 'Five in a row. A-2-3-4-5 counts.'], ['7', 'Three of a Kind', '7♠ 7♥ 7♣ K♦ 2♠', 'Three of one rank.'], ['8', 'Two Pair', 'K♥ K♣ 5♠ 5♦ 9♥', 'Two different pairs.'], ['9', 'One Pair', 'A♣ A♥ Q♠ 8♦ 3♣', 'Two of one rank.'], ['10', 'High Card', 'A♠ J♦ 8♣ 6♥ 2♠', 'Nothing else: the highest card plays.']].map(r => `<tr><td class="n">${r[0]}</td><td><b>${r[1]}</b><br><small>${r[3]}</small></td><td class="cards">${hand(r[2])}</td></tr>`).join('')}</table>`],
    play: ['How to Play', `<h3>How to Play</h3><p>Heads-up No-Limit Texas Hold'em: you against one bot.</p><ol>
      <li><b>Blinds.</b> The button posts the small blind and the other seat the big blind. The button moves every hand.</li>
      <li><b>Hole cards.</b> You get two cards only you can see.</li>
      <li><b>Pre-flop.</b> The button acts first: Fold, Call or Raise.</li>
      <li><b>Flop, Turn, River.</b> Three, then one, then one more card on the board. A betting round after each; the big blind acts first.</li>
      <li><b>Showdown.</b> Best five-card hand wins the pot. Equal hands split it.</li></ol>
      <p><b>Raises</b> must be at least the size of the last bet or raise. <b>All-in</b> with nothing left to bet: the rest of the board is dealt out. Out of chips? Tick <b>Generate Coins</b> in the Bitcoin window.</p>
      <p><b>Pre-action boxes</b> (FOLD, CALL, CALL ANY, RAISE, RAISE ANY) act for you as soon as it is your turn, like in the 2009 window.</p>`],
    keys: ['Keys', `<h3>Keys</h3><table class="kt"><tr><td><kbd>D</kbd></td><td>Deal Hand</td></tr><tr><td><kbd>F</kbd></td><td>Fold</td></tr><tr><td><kbd>C</kbd></td><td>Call or Check</td></tr><tr><td><kbd>R</kbd> / <kbd>Enter</kbd></td><td>Raise to the amount in the box</td></tr><tr><td><kbd>L</kbd></td><td>Leave Table</td></tr><tr><td><kbd>Esc</kbd></td><td>Close the Start menu</td></tr></table>
      <p>Keys work while the Poker window is active. In the Command Prompt type <b>HELP</b> for every command, e.g. <code>raise 2</code>, <code>sit 2</code>, <code>monitor</code>.</p>`],
    tables: ['The Tables', `<h3>The Tables</h3><p>One table per Bitcoin epoch. Your starting stack is that epoch's block reward, and the bot gets sharper.</p><table class="rk">${EPOCHS.map((e, i) => `<tr><td class="n">${i + 1}</td><td><b>${esc(e.name)}</b><br><small>Block ${e.block.toLocaleString('en-US')} · ${e.date}</small></td><td>${fmt(e.stack)}<br><small>blinds ${fmt(e.sb).replace(' BTC', '')}/${fmt(e.bb).replace(' BTC', '')} · bot ${e.level}/5</small></td><td>${e.unlock ? 'opens at $' + compact(e.unlock) + ' mcap' : 'open'}</td></tr>`).join('')}</table>`],
    money: ['Play Money', `<h3>Play Money</h3><p>Every chip at Satoshi's table is play money. It cannot be bought, sold, withdrawn or swapped for $HODLEM or anything else.</p><p>Your stacks, stats, hand history and options are saved in this browser only. Reset them in <a href="#" data-open="optWin">Options</a>.</p><p>$HODLEM is a separate memecoin on Solana. 100% of its creator fees buy back $HODLEM and burn it. See the <a href="#" data-open="binWin">Burn Bin</a>.</p>`],
  };
  let helpCur = 'rank';
  function renderHelp() {
    $('#hpTree').innerHTML = '<div class="hd">Contents</div>' + Object.entries(HELP).map(([k, v]) => `<div data-hp="${k}" class="${k === helpCur ? 'sel' : ''}">${v[0]}</div>`).join('');
    $('#hpPage').innerHTML = HELP[helpCur][1]; $('#hpPage').scrollTop = 0;
    $$('#helpWin .hp-tool [data-hp]').forEach(b => b.classList.toggle('on', b.dataset.hp === helpCur));
  }
  $('#helpWin').addEventListener('click', e => { const b = e.target.closest('[data-hp]'); if (b) { helpCur = b.dataset.hp; renderHelp(); } });
  renderHelp();

  /* ---------- Burn Calculator ---------- */
  let calcIn = '0';
  function renderCalc() {
    $('#cIn').textContent = calcIn;
    const t = S.token, m = t && t.market, sol = parseFloat(calcIn) || 0;
    if (!t || !m || !m.priceSol) { ['#cTok', '#cPct', '#cUsd'].forEach(id => { $(id).textContent = '—'; }); $('#cNote').textContent = S.cfg.ca ? 'Waiting for a live SOL price for $HODLEM.' : 'Live price after launch. Estimate before trading fees and slippage.'; return; }
    const tok = sol / m.priceSol, supply = Number(t.supply) / 10 ** t.decimals;
    $('#cTok').textContent = sol ? compact(tok) + ' $HODLEM' : '—';
    $('#cPct').textContent = sol ? (tok / supply * 100).toFixed(tok / supply * 100 < 0.01 ? 5 : 3) + '%' : '—';
    $('#cUsd').textContent = sol && m.priceUsd ? usd(tok * m.priceUsd) : '—';
    $('#cNote').textContent = 'At $HODLEM ' + usd(m.priceUsd) + '. Estimate before trading fees and slippage.';
  }
  function calcKey(k) {
    if (k === 'C') calcIn = '0';
    else if (k === 'back') calcIn = calcIn.length > 1 ? calcIn.slice(0, -1) : '0';
    else if (k === 'fees') { const f = S.token && S.token.fees ? S.token.fees.totalSol : null; if (f == null) { toast('Fees waiting show up after launch.'); return; } calcIn = String(+f.toFixed(4)); }
    else if (k === '.') { if (!calcIn.includes('.')) calcIn += '.'; }
    else if (calcIn.replace('.', '').length < 9) calcIn = calcIn === '0' ? (k === '00' ? '0' : k) : calcIn + k;
    renderCalc();
  }
  $('#calcKeys').addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (b) calcKey(b.dataset.k); });
  document.addEventListener('keydown', e => {
    if (!$('#calcWin').classList.contains('active') || $('#calcWin').hidden || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    const k = e.key === 'Backspace' ? 'back' : e.key === 'Escape' || e.key === 'Delete' ? 'C' : /^[0-9.]$/.test(e.key) ? e.key : null;
    if (k) { e.preventDefault(); e.stopPropagation(); calcKey(k); }
  }, true);
  renderCalc();

  /* ---------- $HODLEM Monitor: live readouts + a graph of this session's samples ---------- */
  const mon = { s: [], tab: 'mcap', scroll: 0 };
  function monSample(t) {
    const m = t.market || {}, d = 10 ** t.decimals, pct = v => (v > 0 ? '+' : '') + v.toFixed(1) + '%';
    mon.s.push({ t: Date.now(), mcap: m.mcap || null, price: m.priceUsd || null, burn: Number(t.burned) / d }); if (mon.s.length > 240) mon.s.shift();
    $('#mPrice').textContent = usd(m.priceUsd); $('#mMcap').textContent = usd(m.mcap); $('#mVol').textContent = m.vol24 != null ? usd(m.vol24) : '—';
    $('#mChg').textContent = m.chg24 != null && m.priceUsd ? pct(m.chg24) : '—'; $('#mChg1').textContent = m.chg1 != null && m.priceUsd ? pct(m.chg1) : '—';
    $('#mTx').textContent = m.txns24 != null && m.priceUsd ? m.txns24.toLocaleString('en-US') : '—'; $('#mLiq').textContent = m.liq ? usd(m.liq) : '—';
    $('#mCurve').textContent = t.curve ? (t.curve.progress * 100).toFixed(1) + '%' : t.graduated ? 'graduated' : '—';
    $('#mBurn').textContent = compact(Number(t.burned) / d) + ' (' + t.burnedPct.toFixed(2) + '%)'; $('#mFees').textContent = t.fees ? t.fees.totalSol.toFixed(4) + ' SOL' : '—';
    $('#monS0').textContent = m.priceUsd ? 'Live · ' + (m.dex || 'dex') : 'Live on-chain · market data appears after the first trades';
    $('#monS1').textContent = 'Samples: ' + mon.s.length; $('#monS2').textContent = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    drawMon();
  }
  function drawMon() {
    const cv = $('#monCv'), w = cv.clientWidth || 480, h = cv.clientHeight || 150, dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.fillStyle = '#000'; x.fillRect(0, 0, w, h);
    x.strokeStyle = '#0b4d1f'; x.lineWidth = 1; const g = 15, off = mon.scroll % g;
    for (let i = w - off; i > 0; i -= g) { x.beginPath(); x.moveTo(Math.round(i) + .5, 0); x.lineTo(Math.round(i) + .5, h); x.stroke(); }
    for (let j = h; j > 0; j -= g) { x.beginPath(); x.moveTo(0, j + .5); x.lineTo(w, j + .5); x.stroke(); }
    const key = mon.tab, pts = mon.s.filter(p => p[key] != null), cap = $('#monCap'), label = { mcap: 'Market cap', price: 'Price', burn: 'Burned' }[key];
    if (!S.cfg.ca) { cap.textContent = 'Waiting for $HODLEM to launch…'; return; }
    if (!pts.length) { cap.textContent = label + ': no data yet'; return; }
    const vs = pts.map(p => p[key]); let lo = Math.min(...vs), hi = Math.max(...vs); if (hi - lo < hi * 0.002) { lo = lo * 0.995; hi = hi * 1.005 || 1; }
    const X = i => pts.length === 1 ? w - 2 : w - 2 - (pts.length - 1 - i) * Math.max(2, Math.min(15, (w - 4) / (pts.length - 1)));
    const Y = v => h - 8 - (v - lo) / (hi - lo) * (h - 22);
    x.strokeStyle = '#3f3'; x.lineWidth = 1.5; x.beginPath(); pts.forEach((p, i) => { const px = X(i), py = Y(p[key]); i ? x.lineTo(px, py) : x.moveTo(px, py); }); x.stroke();
    if (pts.length === 1) { x.fillStyle = '#3f3'; x.fillRect(X(0) - 2, Y(vs[0]) - 2, 4, 4); }
    const last = vs[vs.length - 1]; cap.textContent = label + ' ' + (key === 'burn' ? compact(last) : usd(last)) + ' · this session, one sample every 15 s';
  }
  $('#monWin .mon-tabs').addEventListener('click', e => { const b = e.target.closest('[data-mt]'); if (!b) return; mon.tab = b.dataset.mt; $$('#monWin [data-mt]').forEach(x => x.classList.toggle('on', x === b)); drawMon(); });
  setInterval(() => { if (!document.hidden && wstate.monWin === 'open') { mon.scroll += 15; if (S.cfg.ca) loadToken(); else drawMon(); } }, 15000);

  /* ---------- System Status (the honest table) ---------- */
  function renderStatus() {
    const c = S.cfg || {}, t = S.token, m = t && t.market, rows = [];
    const row = (part, st, cls, det) => rows.push(`<tr><td>${part}</td><td class="${cls}">${st}</td><td>${det}</td></tr>`);
    row('Poker game', 'LIVE', 'ok', 'Heads-up No-Limit Hold\'em against a bot. Play money, runs in your browser.');
    row('X player card (/play)', 'LIVE', 'ok', 'Post the link on X and the table plays inside the post.');
    row('Five tables', 'LIVE', 'ok', EPOCHS.filter(open).length + ' of 5 open at the current market cap.');
    row('$HODLEM token', c.ca ? (t ? 'LIVE' : S.tokErr ? 'OFFLINE' : 'CHECKING') : 'NOT LAUNCHED', c.ca ? (t ? 'ok' : 'wait') : 'off', c.ca ? esc(short(c.ca)) + ' on Solana' : 'The contract address appears here at launch.');
    row('Market data', m && m.priceUsd ? 'LIVE' : c.ca ? 'WAITING' : '—', m && m.priceUsd ? 'ok' : 'off', m && m.priceUsd ? 'Price ' + usd(m.priceUsd) + ' · mcap ' + usd(m.mcap) + ' (Dexscreener)' : 'Shows up once the first trades are indexed.');
    row('Buyback &amp; burn tool', c.ca ? 'READY' : 'AT LAUNCH', c.ca ? 'ok' : 'off', 'Claim fees → buy $HODLEM → burn exactly what was bought, in one signed transaction.');
    row('Burn ledger', c.ca ? (S.burns ? 'LIVE' : 'CHECKING') : 'AT LAUNCH', c.ca && S.burns ? 'ok' : 'off', S.burns ? S.burns.length + ' burn(s) read from the chain. Burned = 1B − supply.' : 'Reads every burn from the creator and burn wallets.');
    row('Creator wallet', c.creator ? 'SET' : 'NOT SET', c.creator ? 'ok' : 'off', c.creator ? esc(short(c.creator)) + ' · see Address Book' : 'Set at launch.');
    row('Worldwide hand counter', c.kv ? 'LIVE' : 'OFF', c.kv ? 'ok' : 'off', c.kv ? (S.global != null ? S.global.toLocaleString('en-US') + ' hands dealt so far.' : 'Counting.') : 'Turns on when the counter database is connected.');
    $('#stRows').innerHTML = rows.join('');
    $('#stS0').textContent = 'Checked ' + new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' · refreshes with the chain data';
  }

  /* ---------- boot screen (real steps, skippable) ---------- */
  let booting = true;
  const bootEl = $('#boot'), bootLog = $('#bootLog');
  const seen = (() => { try { return sessionStorage.getItem('hodlem:boot') === '1'; } catch (e) { return false; } })();
  function bootLine(label, status) { const dots = '.'.repeat(Math.max(3, 30 - label.length)); bootLog.insertAdjacentHTML('beforeend', `${esc(label)} ${dots} ${status}\n`); }
  function bootDone() {
    if (!booting) return; booting = false;
    try { sessionStorage.setItem('hodlem:boot', '1'); } catch (e) { }
    bootEl.classList.add('done'); setTimeout(() => { bootEl.hidden = true; }, 500);
    document.removeEventListener('keydown', bootSkip, true); bootEl.removeEventListener('click', bootSkip);
    cmdPrint('HODLEM [Version 0.1.2009]\nThe poker table from Bitcoin v0.1, finished. Play money only.\n\nType HELP for commands.\n');
  }
  function bootSkip(e) { if (booting) { e.preventDefault(); e.stopPropagation(); bootDone(); } }
  document.addEventListener('keydown', bootSkip, true); bootEl.addEventListener('click', bootSkip);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  async function runBoot(chainReady) {
    const gap = seen ? 40 : 170;
    bootLine('Loading uibase.h', '<i>OK</i>'); await wait(gap);
    bootLine('CPokerLobbyDialogBase', '<i>OK</i>'); await wait(gap);
    bootLine('CPokerDialogBase', '<i>OK</i>'); await wait(gap);
    try { await Promise.race([document.fonts.ready, wait(2500)]); } catch (e) { }
    bootLine('Fonts', '<i>OK</i>'); await wait(gap);
    bootLine('Shuffling 52 cards', game ? '<i>OK</i>' : '<b>FAIL</b>'); await wait(gap);
    const chain = await Promise.race([chainReady, wait(3200).then(() => 'slow')]);
    bootLine('$HODLEM on Solana', chain === 'live' ? '<i>OK</i>' : chain === 'prelaunch' ? '<b>NOT LAUNCHED</b>' : '<b>OFFLINE</b>'); await wait(gap);
    bootLog.insertAdjacentHTML('beforeend', '\nDealing the first hand since 2009_');
    await wait(seen ? 150 : 700); bootDone();
  }

  /* ---------- nav highlight ---------- */
  const onScroll = () => { let cur = null; for (const a of $$('#nav a')) { const s = document.getElementById(a.getAttribute('href').slice(1)); if (s && s.getBoundingClientRect().top < 140) cur = a; } $$('#nav a').forEach(a => a.classList.toggle('on', a === cur)); };
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ---------- boot ---------- */
  renderLobby();
  // initial desktop: some windows start minimised
  if (big()) { minWin($('#webWin')); minWin($('#readmeWin')); ['mainWin', 'lobbyWin', 'cmdWin', 'pokerWin'].forEach(id => focusWin(document.getElementById(id))); }
  else { minWin($('#readmeWin')); focusWin($('#pokerWin')); }
  renderTaskbar();
  const chainReady = loadConfig().then(async () => { if (!S.cfg.ca) { return 'prelaunch'; } await loadToken(); loadBurns(); return S.token ? 'live' : 'offline'; }).catch(() => 'offline');
  runBoot(chainReady);
  getHands();
  setInterval(() => { if (!document.hidden) loadToken(); }, 20000);
  setInterval(() => { if (!document.hidden) loadBurns(); }, 60000);
  setInterval(() => { if (!document.hidden) getHands(); }, 30000);
})();
