'use strict';
/*
 * HODLEM API. One serverless function behind /api/*.
 *
 * It never holds keys or funds. It reads the chain, builds unsigned transactions with the official
 * pump.fun SDKs, simulates them, and hands them to the user's own wallet to sign.
 *
 * Routes
 *   GET  /api/config            public settings (CA, X, creator wallet)
 *   GET  /api/token             live $HODLEM: supply, burned, curve progress, price, creator fees waiting
 *   GET  /api/burns             recent burns by the creator (and any extra burner wallets), parsed on-chain
 *   GET  /api/wallet?user=      a wallet's SOL + $HODLEM and what it may claim (creator / fee-share)
 *   POST /api/tx                build + simulate a burn: {user, sol, claim, slippage}
 *   POST /api/send              relay a signed transaction
 *   GET  /api/status?sig=       confirmation status
 *   GET  /api/hands             global hands-dealt counter (needs Upstash/KV env; else null)
 *   POST /api/hands             +1 hand
 */
const {
  Connection, PublicKey, TransactionMessage, VersionedTransaction, ComputeBudgetProgram, SystemProgram, TransactionInstruction,
} = require('@solana/web3.js');
const {
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, NATIVE_MINT, MintLayout, AccountLayout,
  getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, createSyncNativeInstruction,
  createCloseAccountInstruction, createBurnCheckedInstruction,
} = require('@solana/spl-token');
const BN = require('bn.js');
const pump = require('@pump-fun/pump-sdk');
const { PUMP_SDK, OnlinePumpSdk, PUMP_PROGRAM_ID, bondingCurvePda, feeSharingConfigPda, getBuyTokenAmountFromSolAmount } = pump;
const { PUMP_AMM_SDK, PUMP_AMM_PROGRAM_ID, GLOBAL_CONFIG_PDA, PUMP_AMM_FEE_CONFIG_PDA, POOL_ACCOUNT_NEW_SIZE, canonicalPumpPoolPda, computeFeesBps } = require('@pump-fun/pump-swap-sdk');

/* ---------------- settings ---------------- */
const E = (k, d = '') => String(process.env[k] == null ? d : process.env[k]).trim();
const okKey = s => { try { return s ? new PublicKey(s).toBase58() : ''; } catch (e) { return ''; } };
const CONFIG = {
  ca: okKey(E('HODLEM_CA')),
  x: E('HODLEM_X', ''),
  creator: okKey(E('HODLEM_CREATOR')),             // wallet that launched $HODLEM (its creator fees are bought back + burned)
  burners: E('HODLEM_BURNERS', '').split(',').map(s => okKey(s.trim())).filter(Boolean),
};
const RPCS = [E('RPC_URL'), 'https://solana-rpc.publicnode.com', 'https://api.mainnet-beta.solana.com'].filter(Boolean);
const KV_URL = E('KV_REST_API_URL') || E('UPSTASH_REDIS_REST_URL');
const KV_TOKEN = E('KV_REST_API_TOKEN') || E('UPSTASH_REDIS_REST_TOKEN');
const MEMO = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const INITIAL_SUPPLY = 1_000_000_000n * 1_000_000n; // every pump.fun coin starts at 1B with 6 decimals
const ERRORS = {
  6002: 'The price moved too much. Try again or raise slippage.', 6003: 'The pool has too little liquidity for this size.',
  6004: 'The price moved too much. Try again or raise slippage.', 6005: 'The curve is complete. Refresh and try again.',
  6040: 'The price moved too much. Try again or raise slippage.', 6039: 'Not enough SOL to cover the trade fees.',
  6020: 'Buys are paused right now.', 6063: 'This pool does not have enough real SOL for that.',
};

/* ---------------- http + rpc helpers ---------------- */
function send(res, code, body, cache) {
  res.setHeader('Cache-Control', cache || 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.status(code).send(JSON.stringify(body));
}
function http(code, msg) { const e = new Error(msg); e.code = code; return e; }
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  return await new Promise(r => { let d = ''; req.on('data', c => { d += c; if (d.length > 2e5) d = ''; }); req.on('end', () => { try { r(JSON.parse(d || '{}')); } catch (e) { r({}); } }); });
}
function timedFetch(ms) {
  return (url, opt = {}) => { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms); return fetch(url, { ...opt, signal: c.signal }).finally(() => clearTimeout(t)); };
}
const conns = RPCS.map(u => new Connection(u, { commitment: 'confirmed', disableRetryOnRateLimit: true, fetch: timedFetch(9000) }));
async function rpc(fn) {
  let last;
  for (const c of conns) { try { return await fn(c); } catch (e) { last = e; } }
  throw http(502, 'Solana RPC is busy: ' + String(last && last.message || last).slice(0, 140));
}
async function getJson(url, ms = 7000) {
  const r = await timedFetch(ms)(url, { headers: { accept: 'application/json', 'user-agent': 'hodlem/1.0' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return await r.json();
}
const mem = {};
async function cached(key, ms, fn) {
  const c = mem[key];
  if (c && c.has && Date.now() - c.t < ms) return c.v;
  if (c && c.p) return c.p;
  const p = (async () => {
    try { const v = await fn(); mem[key] = { t: Date.now(), v, has: true }; return v; }
    catch (e) { if (c && c.has) { mem[key] = { t: c.t, v: c.v, has: true }; return c.v; } delete mem[key]; throw e; }
  })();
  mem[key] = Object.assign({}, c || {}, { p });
  return p;
}
function pk(s, what = 'address') { try { return new PublicKey(String(s || '').trim()); } catch (e) { throw http(400, 'Invalid ' + what); } }
const big = v => BigInt(v.toString());
const ceilDiv = (a, b) => (a + b - 1n) / b;
const sol = l => Number(l) / 1e9;
function mintKey(q) {
  const m = (q && q.get('mint')) || CONFIG.ca;
  if (!m) throw http(404, 'The $HODLEM contract address is not set yet.');
  return pk(m, 'mint');
}

/* ---------------- token state ---------------- */
let online = null;
const sdk = () => (online = online || new OnlinePumpSdk(conns[0]));
async function curveGlobals() {
  return cached('pglobals', 60000, async () => {
    const s = sdk();
    const [g, f] = await Promise.all([s.fetchGlobal(), s.fetchFeeConfig().catch(() => null)]);
    return { global: g, feeConfig: f };
  });
}
async function ammGlobals() {
  return cached('aglobals', 60000, async () => {
    const [g, f] = await rpc(c => c.getMultipleAccountsInfo([GLOBAL_CONFIG_PDA, PUMP_AMM_FEE_CONFIG_PDA]));
    if (!g) throw http(502, 'PumpSwap global config not found');
    return { globalConfig: PUMP_AMM_SDK.decodeGlobalConfig(g), feeConfig: f ? PUMP_AMM_SDK.decodeFeeConfig(f) : null };
  });
}
// mint + curve + canonical pool, one round trip
async function coinState(mint) {
  const curveKey = bondingCurvePda(mint), poolKey = canonicalPumpPoolPda(mint);
  const [mi, ci, pi] = await rpc(c => c.getMultipleAccountsInfo([mint, curveKey, poolKey]));
  if (!mi) throw http(404, 'Mint not found on-chain.');
  const tokenProgram = mi.owner;
  if (!tokenProgram.equals(TOKEN_PROGRAM_ID) && !tokenProgram.equals(TOKEN_2022_PROGRAM_ID)) throw http(400, 'Not an SPL token mint.');
  const m = MintLayout.decode(mi.data.slice(0, MintLayout.span));
  const st = { mint, tokenProgram, decimals: m.decimals, supply: big(m.supply), curveKey, poolKey, curveInfo: ci, poolInfo: pi };
  if (ci && ci.owner.equals(PUMP_PROGRAM_ID)) st.curve = PUMP_SDK.decodeBondingCurve(ci);
  if (pi && pi.owner.equals(PUMP_AMM_PROGRAM_ID)) st.pool = PUMP_AMM_SDK.decodePool(pi);
  st.graduated = !!(st.curve ? st.curve.complete : st.pool);
  st.creator = st.curve ? st.curve.creator : (st.pool ? st.pool.coinCreator : null);
  st.sharing = !!(st.creator && st.creator.equals(feeSharingConfigPda(mint)));
  return st;
}
async function creatorVaults(creator) {
  try {
    const s = sdk();
    const [a, b] = await Promise.all([s.getCreatorVaultBalance(creator).catch(() => new BN(0)), PUMP_AMM_SDK && s.pumpAmmSdk ? s.pumpAmmSdk.getCoinCreatorVaultBalance(creator).catch(() => new BN(0)) : Promise.resolve(new BN(0))]);
    return { curve: big(a), amm: big(b) };
  } catch (e) { return { curve: 0n, amm: 0n }; }
}
async function sharing(mint) {
  try {
    const info = await rpc(c => c.getAccountInfo(feeSharingConfigPda(mint)));
    if (!info) return null;
    const sc = PUMP_SDK.decodeSharingConfig(info);
    return { shareholders: (sc.shareholders || []).map(s => ({ address: s.address.toBase58(), bps: Number(s.shareBps) })) };
  } catch (e) { return null; }
}
async function market(mint) {
  return cached('mkt:' + mint, 20000, async () => {
    try {
      const j = await getJson('https://api.dexscreener.com/latest/dex/tokens/' + mint, 6000);
      const pairs = (j.pairs || []).filter(p => p.chainId === 'solana');
      if (!pairs.length) return null;
      pairs.sort((a, b) => ((b.liquidity && b.liquidity.usd) || 0) - ((a.liquidity && a.liquidity.usd) || 0));
      const p = pairs[0];
      return {
        priceUsd: +p.priceUsd || null, priceSol: p.quoteToken && /^(SOL|WSOL)$/i.test(p.quoteToken.symbol) ? +p.priceNative || null : null, mcap: +(p.marketCap || p.fdv) || null, vol24: p.volume ? +p.volume.h24 || 0 : 0,
        chg24: p.priceChange ? +p.priceChange.h24 || 0 : 0, chg1: p.priceChange ? +p.priceChange.h1 || 0 : 0,
        txns24: p.txns && p.txns.h24 ? (p.txns.h24.buys || 0) + (p.txns.h24.sells || 0) : 0,
        liq: p.liquidity ? +p.liquidity.usd || 0 : 0, dex: p.dexId, pair: p.pairAddress, url: p.url,
      };
    } catch (e) { return null; }
  });
}
async function token(mint) {
  return cached('tok:' + mint.toBase58(), 15000, async () => {
    const [st, g] = await Promise.all([coinState(mint), curveGlobals().catch(() => null)]);
    const initial = st.curve ? big(st.curve.tokenTotalSupply) || INITIAL_SUPPLY : INITIAL_SUPPLY;
    const burned = initial > st.supply ? initial - st.supply : 0n;
    const out = {
      mint: mint.toBase58(), decimals: st.decimals, tokenProgram: st.tokenProgram.toBase58(),
      initial: initial.toString(), supply: st.supply.toString(), burned: burned.toString(),
      burnedPct: Number(burned * 1000000n / (initial || 1n)) / 10000,
      graduated: st.graduated, creator: st.creator ? st.creator.toBase58() : null, sharing: st.sharing,
    };
    if (st.curve && !st.curve.complete && g) {
      const init = big(g.global.initialRealTokenReserves || '793100000000000');
      const left = big(st.curve.realTokenReserves);
      out.curve = { progress: init > 0n ? Math.max(0, Math.min(1, Number(init - left) / Number(init))) : 0, realSol: sol(big(st.curve.realQuoteReserves)) };
    }
    if (st.creator) {
      const v = await creatorVaults(st.creator);
      out.fees = { curveSol: sol(v.curve), ammSol: sol(v.amm), totalSol: sol(v.curve + v.amm) };
    }
    out.market = await market(out.mint);
    out.updated = Date.now();
    return out;
  });
}

/* ---------------- burn ledger ---------------- */
function burnsIn(tx, mintStr) {
  const found = [];
  const scan = ix => {
    const p = ix && ix.parsed; if (!p || typeof p !== 'object') return;
    if ((p.type === 'burn' || p.type === 'burnChecked') && p.info && p.info.mint === mintStr) {
      const amt = p.info.tokenAmount ? p.info.tokenAmount.amount : p.info.amount;
      found.push({ amount: String(amt || '0'), authority: p.info.authority || p.info.multisigAuthority || '' });
    }
  };
  (tx.transaction.message.instructions || []).forEach(scan);
  ((tx.meta && tx.meta.innerInstructions) || []).forEach(g => (g.instructions || []).forEach(scan));
  return found;
}
async function burns(mint) {
  const mintStr = mint.toBase58();
  return cached('burns:' + mintStr, 90000, async () => {
    const wallets = [...new Set([CONFIG.creator, ...CONFIG.burners].filter(Boolean))];
    if (!wallets.length) return { list: [], wallets: [] };
    const list = [];
    for (const w of wallets.slice(0, 4)) {
      let sigs = [];
      try { sigs = await rpc(c => c.getSignaturesForAddress(new PublicKey(w), { limit: 80 })); } catch (e) { continue; }
      sigs = sigs.filter(s => !s.err);
      for (let i = 0; i < sigs.length; i += 20) {
        const part = sigs.slice(i, i + 20);
        let txs = [];
        try { txs = await rpc(c => c.getParsedTransactions(part.map(s => s.signature), { maxSupportedTransactionVersion: 0, commitment: 'confirmed' })); } catch (e) { continue; }
        txs.forEach((tx, k) => {
          if (!tx) return;
          const b = burnsIn(tx, mintStr);
          if (!b.length) return;
          const total = b.reduce((a, x) => a + BigInt(x.amount), 0n);
          let solSpent = null;
          try { const keys = tx.transaction.message.accountKeys; const idx = keys.findIndex(k2 => (k2.pubkey ? k2.pubkey.toString() : String(k2)) === w); if (idx >= 0) solSpent = (tx.meta.preBalances[idx] - tx.meta.postBalances[idx]) / 1e9; } catch (e) { }
          list.push({ sig: part[k].signature, t: (tx.blockTime || 0) * 1000, amount: total.toString(), wallet: w, solDelta: solSpent });
        });
      }
    }
    list.sort((a, b) => b.t - a.t);
    const uniq = []; const seen = new Set(); for (const x of list) { if (seen.has(x.sig)) continue; seen.add(x.sig); uniq.push(x); }
    return { list: uniq.slice(0, 40), wallets };
  });
}

/* ---------------- wallet ---------------- */
async function wallet(mint, user) {
  const st = await coinState(mint);
  const ata = getAssociatedTokenAddressSync(mint, user, true, st.tokenProgram);
  const [ua, ta] = await rpc(c => c.getMultipleAccountsInfo([user, ata]));
  const bal = ta ? big(AccountLayout.decode(ta.data.slice(0, AccountLayout.span)).amount) : 0n;
  const out = { sol: sol(BigInt(ua ? ua.lamports : 0)), hodlem: bal.toString(), decimals: st.decimals, isCreator: false, claimSol: 0, share: null };
  if (st.creator && st.creator.equals(user)) {
    const v = await creatorVaults(user); out.isCreator = true; out.claimSol = sol(v.curve + v.amm);
  } else if (st.sharing) {
    const sh = await sharing(mint);
    const me = sh && sh.shareholders.find(s => s.address === user.toBase58());
    if (me) { const v = await creatorVaults(st.creator); out.share = me.bps; out.claimSol = sol((v.curve + v.amm) * BigInt(me.bps) / 10000n); }
  }
  return out;
}

/* ---------------- transactions ---------------- */
async function priorityFee(keys) {
  try {
    const r = await cached('prio:' + (keys[0] ? keys[0].toBase58() : ''), 20000, () => rpc(c => c.getRecentPrioritizationFees(keys.length ? { lockedWritableAccounts: keys.slice(0, 1) } : undefined)));
    const v = r.map(x => x.prioritizationFee).filter(x => x > 0).sort((a, b) => a - b);
    const p = v.length ? v[Math.floor(v.length * 0.7)] : 60000;
    return Math.max(25000, Math.min(1500000, p));
  } catch (e) { return 60000; }
}
async function compile(user, ixs, cu, price, blockhash) {
  const all = [ComputeBudgetProgram.setComputeUnitLimit({ units: cu }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: price }), ...ixs];
  const msg = new TransactionMessage({ payerKey: user, recentBlockhash: blockhash, instructions: all }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  try { const bytes = tx.serialize(); return bytes.length <= 1232 ? { tx, bytes } : null; } catch (e) { return null; }
}
function explain(sim) {
  const logs = (sim && sim.logs) || [];
  const m = JSON.stringify(sim && sim.err || '').match(/"Custom":(\d+)/);
  if (m && ERRORS[m[1]]) return ERRORS[m[1]];
  const l = logs.join('\n');
  if (/insufficient lamports|insufficient funds/i.test(l)) return 'Not enough SOL in the wallet for this, including network fees.';
  if (/slippage|TooMuchSolRequired|TooLittleSolReceived/i.test(l)) return ERRORS[6004];
  if (m) return 'The program rejected it (error ' + m[1] + ').';
  return 'The transaction would fail: ' + JSON.stringify(sim && sim.err).slice(0, 120);
}
async function finish(user, ixs, hot) {
  const { blockhash, lastValidBlockHeight } = await rpc(c => c.getLatestBlockhash('confirmed'));
  const price = await priorityFee(hot ? [hot] : []);
  const first = await compile(user, ixs, 1_000_000, price, blockhash);
  if (!first) throw http(500, 'Transaction too large');
  const r = await rpc(c => c.simulateTransaction(first.tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: 'processed' }));
  const sim = r.value;
  if (sim.err) { const e = http(400, explain(sim)); e.logs = (sim.logs || []).slice(-14); throw e; }
  const units = Math.min(1_400_000, Math.ceil((sim.unitsConsumed || 300000) * 1.2) + 20000);
  const fin = await compile(user, ixs, units, price, blockhash);
  return { tx: Buffer.from(fin.bytes).toString('base64'), bytes: fin.bytes.length, units, sim: { units: sim.unitsConsumed }, blockhash, lastValidBlockHeight };
}
const memoIx = text => new TransactionInstruction({ programId: MEMO, keys: [], data: Buffer.from(text, 'utf8') });
const wsolAta = user => getAssociatedTokenAddressSync(NATIVE_MINT, user, true, TOKEN_PROGRAM_ID);
// PumpSwap: exact quote budget -> base out (mirrors the program's buy math), slippage kept inside the budget
async function ammQuote(st, budget, slipBps) {
  const { globalConfig, feeConfig } = await ammGlobals();
  const pool = st.pool;
  const [pb, pq, bm] = await rpc(c => c.getMultipleAccountsInfo([pool.poolBaseTokenAccount, pool.poolQuoteTokenAccount, pool.baseMint]));
  const Rb = big(AccountLayout.decode(pb.data.slice(0, AccountLayout.span)).amount);
  const Rq = big(AccountLayout.decode(pq.data.slice(0, AccountLayout.span)).amount);
  const vqr = big(pool.virtualQuoteReserves || 0);
  const baseMintAccount = MintLayout.decode(bm.data.slice(0, MintLayout.span));
  const f = computeFeesBps({
    globalConfig, feeConfig, creator: pool.creator, baseMintSupply: new BN(baseMintAccount.supply.toString()), baseMint: pool.baseMint,
    baseReserve: new BN(Rb.toString()), quoteReserve: new BN((Rq + vqr).toString()), quoteMint: pool.quoteMint,
    isMayhemMode: pool.isMayhemMode, creatorFeeBps: pool.creatorFeeBps,
  });
  const hasCreator = !pool.coinCreator.equals(PublicKey.default);
  const fee = big(f.lpFeeBps) + big(f.protocolFeeBps) + (hasCreator ? big(f.creatorFeeBps) : 0n);
  const cost = b => { const q = ceilDiv((Rq + vqr) * b, Rb - b); return q + ceilDiv(q * fee, 10000n) + 2n; };
  const target = budget * (10000n - slipBps) / 10000n;
  let lo = 0n, hi = Rb / 2n;
  for (let i = 0; i < 100 && hi - lo > 1n; i++) { const mid = (lo + hi) / 2n; if (cost(mid) <= target) lo = mid; else hi = mid; }
  if (lo <= 0n) throw http(400, 'That amount is too small to buy any $HODLEM.');
  return { baseOut: lo, globalConfig, feeConfig, Rb, Rq, baseMintAccount };
}
async function buildBurn(b) {
  const user = pk(b.user, 'wallet');
  const mint = CONFIG.ca ? new PublicKey(CONFIG.ca) : pk(b.mint, 'mint');
  const st = await coinState(mint);
  const slipPct = Math.max(0.5, Math.min(25, Number(b.slippage) || 3));
  const slipBps = BigInt(Math.round(slipPct * 100));
  const ixs = [];
  let claimLamports = 0n;
  // 1) claim creator fees (creator wallet) or crank a fee-sharing payout (shareholder)
  if (b.claim) {
    if (st.creator && st.creator.equals(user)) {
      const v = await creatorVaults(user); claimLamports = v.curve + v.amm;
      if (claimLamports > 0n) ixs.push(...await sdk().collectCoinCreatorFeeInstructions(user, user));
    } else if (st.sharing) {
      const sh = await sharing(mint); const me = sh && sh.shareholders.find(s => s.address === user.toBase58());
      if (!me) throw http(403, 'This wallet is not a creator-fee shareholder of $HODLEM.');
      const v = await creatorVaults(st.creator); claimLamports = (v.curve + v.amm) * BigInt(me.bps) / 10000n;
      if (claimLamports > 0n) ixs.push(...await sdk().buildDistributeCreatorFeesInstructions(mint, { payer: user }));
    } else throw http(403, 'Only the creator wallet can claim $HODLEM creator fees.');
    // the AMM part of a claim lands as wSOL: unwrap it so everything is plain SOL again
    if (st.pool) ixs.push(createAssociatedTokenAccountIdempotentInstruction(user, wsolAta(user), user, NATIVE_MINT, TOKEN_PROGRAM_ID), createCloseAccountInstruction(wsolAta(user), user, user, [], TOKEN_PROGRAM_ID));
  }
  const extra = BigInt(Math.floor(Math.max(0, Number(b.sol) || 0) * 1e9));
  const budget = (b.claim ? claimLamports : 0n) + extra;
  if (budget < 1_000_000n) throw http(400, b.claim ? 'There are no creator fees to claim right now (min 0.001 SOL).' : 'Enter at least 0.001 SOL.');
  const ata = getAssociatedTokenAddressSync(mint, user, true, st.tokenProgram);
  let tokens, route;
  if (!st.graduated && st.curve) {
    // 2a) buy on the bonding curve, exact tokens, max SOL = budget
    route = 'curve';
    const { global, feeConfig } = await curveGlobals();
    const spend = budget * 10000n / (10000n + slipBps);
    tokens = big(getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply: new BN(st.supply.toString()), bondingCurve: st.curve, amount: new BN(spend.toString()), quoteMint: st.curve.quoteMint || NATIVE_MINT }));
    if (tokens <= 0n) throw http(400, 'That amount is too small to buy any $HODLEM.');
    const ataInfo = await rpc(c => c.getAccountInfo(ata));
    ixs.push(...await PUMP_SDK.buyInstructions({ global, bondingCurveAccountInfo: st.curveInfo, bondingCurve: st.curve, associatedUserAccountInfo: ataInfo, mint, user, amount: new BN(tokens.toString()), solAmount: new BN(spend.toString()), slippage: slipPct, tokenProgram: st.tokenProgram }));
  } else if (st.pool) {
    // 2b) buy on PumpSwap with wSOL, exact base out, max quote = budget
    route = 'pumpswap';
    const q = await ammQuote(st, budget, slipBps); tokens = q.baseOut;
    const [ataInfo, wInfo] = await rpc(c => c.getMultipleAccountsInfo([ata, wsolAta(user)]));
    ixs.push(createAssociatedTokenAccountIdempotentInstruction(user, wsolAta(user), user, NATIVE_MINT, TOKEN_PROGRAM_ID),
      SystemProgram.transfer({ fromPubkey: user, toPubkey: wsolAta(user), lamports: budget }), createSyncNativeInstruction(wsolAta(user), TOKEN_PROGRAM_ID));
    const state = {
      globalConfig: q.globalConfig, feeConfig: q.feeConfig, poolKey: st.poolKey,
      poolAccountInfo: { ...st.poolInfo, data: Buffer.alloc(Math.max(st.poolInfo.data.length, POOL_ACCOUNT_NEW_SIZE)) },
      pool: st.pool, poolBaseAmount: new BN(q.Rb.toString()), poolQuoteAmount: new BN(q.Rq.toString()),
      baseTokenProgram: st.tokenProgram, quoteTokenProgram: TOKEN_PROGRAM_ID, baseMint: mint, baseMintAccount: q.baseMintAccount,
      user, userBaseTokenAccount: ata, userQuoteTokenAccount: wsolAta(user), userBaseAccountInfo: ataInfo, userQuoteAccountInfo: wInfo,
    };
    const sdkIxs = await PUMP_AMM_SDK.buyInstructions(state, new BN(tokens.toString()), new BN(budget.toString()));
    ixs.push(...sdkIxs.filter(ix => ix.programId.equals(PUMP_AMM_PROGRAM_ID) || (ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID) && !ix.keys[3].pubkey.equals(NATIVE_MINT))));
    ixs.push(createCloseAccountInstruction(wsolAta(user), user, user, [], TOKEN_PROGRAM_ID));
  } else throw http(400, 'No bonding curve or PumpSwap pool found for $HODLEM.');
  // 3) burn exactly what was bought
  ixs.push(createBurnCheckedInstruction(ata, mint, user, tokens, st.decimals, [], st.tokenProgram));
  ixs.push(memoIx('hodlem:burn ' + (Number(tokens) / 10 ** st.decimals).toFixed(0) + (b.claim ? ' fees' : '')));
  const tx = await finish(user, ixs, st.graduated ? st.poolKey : st.curveKey);
  return {
    txs: [tx],
    quote: { route, claimSol: sol(claimLamports), extraSol: sol(extra), spendSol: sol(budget), tokens: tokens.toString(), decimals: st.decimals, slippage: slipPct },
  };
}
async function relay(b) {
  const raw = Buffer.from(String(b.tx || ''), 'base64');
  if (raw.length < 64 || raw.length > 1232) throw http(400, 'Bad transaction');
  const sig = await rpc(c => c.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 4 }));
  return { sig };
}
async function status(sig) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(sig || '')) throw http(400, 'Bad signature');
  const r = await rpc(c => c.getSignatureStatuses([sig], { searchTransactionHistory: true }));
  const s = r.value[0];
  return { status: s ? s.confirmationStatus : 'unknown', err: s ? s.err : null };
}

/* ---------------- hands counter (Upstash / Vercel KV REST) ---------------- */
const hits = new Map();
async function kv(cmd) {
  if (!KV_URL || !KV_TOKEN) return null;
  const r = await timedFetch(4000)(KV_URL.replace(/\/$/, '') + '/' + cmd, { method: 'POST', headers: { authorization: 'Bearer ' + KV_TOKEN } });
  if (!r.ok) throw new Error('kv ' + r.status);
  const j = await r.json(); return j.result;
}
async function hands(req, method) {
  if (!KV_URL) return { count: null };
  if (method === 'POST') {
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0] || 'x';
    const now = Date.now(), last = hits.get(ip) || 0;
    if (now - last < 1500) return { count: Number(await kv('get/hodlem:hands')) || 0, throttled: true };
    hits.set(ip, now); if (hits.size > 5000) hits.clear();
    return { count: Number(await kv('incr/hodlem:hands')) || 0 };
  }
  return cached('hands', 5000, async () => ({ count: Number(await kv('get/hodlem:hands')) || 0 }));
}

/* ---------------- router ---------------- */
module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const path = String(url.searchParams.get('__p') || url.pathname.replace(/^\/api\/?/, '')).replace(/^\/+|\/+$/g, '');
    const q = url.searchParams;
    if (req.method === 'OPTIONS') return send(res, 204, {});
    if (path === 'config') return send(res, 200, { ok: true, ca: CONFIG.ca, x: CONFIG.x, creator: CONFIG.creator, burners: CONFIG.burners, kv: !!KV_URL }, 'public, s-maxage=60');
    if (path === 'token') return send(res, 200, { ok: true, token: await token(mintKey(q)) }, 'public, s-maxage=10, stale-while-revalidate=30');
    if (path === 'burns') return send(res, 200, { ok: true, ...(await burns(mintKey(q))) }, 'public, s-maxage=60, stale-while-revalidate=120');
    if (path === 'wallet') return send(res, 200, { ok: true, wallet: await wallet(mintKey(q), pk(q.get('user'), 'wallet')) });
    if (path === 'status') return send(res, 200, { ok: true, ...(await status(q.get('sig'))) });
    if (path === 'hands') return send(res, 200, { ok: true, ...(await hands(req, req.method)) }, req.method === 'GET' ? 'public, s-maxage=5' : 'no-store');
    if (req.method === 'POST') {
      const b = await readBody(req);
      if (path === 'tx') { if (!q.get('mint') && b.mint) q.set('mint', b.mint); return send(res, 200, { ok: true, ...(await buildBurn(b)) }); }
      if (path === 'send') return send(res, 200, { ok: true, ...(await relay(b)) });
    }
    return send(res, 404, { ok: false, error: 'Not found' });
  } catch (e) {
    const code = e.code && e.code >= 400 && e.code < 600 ? e.code : 500;
    return send(res, code, { ok: false, error: String(e.message || e).slice(0, 300), logs: e.logs });
  }
};
