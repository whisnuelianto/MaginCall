/* RiskDesk v2 — app.js
 * Kalkulator risiko, jurnal, analitik, dan jembatan MT5.
 * Semua data disimpan di localStorage; sinkronisasi cloud (Supabase) bersifat opsional.
 */
(() => {
"use strict";

const VERSION = "2.1.0";
const KEY = "riskdesk.v2", OLD_KEY = "riskdesk.v1", AUTH_KEY = "riskdesk.auth";

/* ================================================================
 * 1. DATA BAWAAN
 * ================================================================ */
// s=simbol, c=kategori, cs=contract size, pip=ukuran pip, d=digit, q=mata uang kutipan,
// spr=spread (pip), swL/swS=swap buy/sell per lot per malam (mata uang akun)
const mk = (s, c, cs, pip, d, q, spr) => ({ s, c, cs, pip, d, q, spr, swL: 0, swS: 0 });
const fx = (s, c, spr) => mk(s, c, 100000, s.endsWith("JPY") ? 0.01 : 0.0001, s.endsWith("JPY") ? 3 : 5, s.slice(3), spr);
const DEFAULT_SYMBOLS = [
  ...["EURUSD","GBPUSD","USDJPY","USDCHF","USDCAD","AUDUSD","NZDUSD"].map(s => fx(s, "Forex Major", 1.2)),
  ...["EURGBP","EURJPY","EURCHF","EURAUD","EURCAD","EURNZD","GBPJPY","GBPCHF","GBPAUD","GBPCAD","GBPNZD",
      "AUDJPY","AUDCHF","AUDCAD","AUDNZD","NZDJPY","NZDCHF","NZDCAD","CADJPY","CADCHF","CHFJPY"].map(s => fx(s, "Forex Minor", 2.5)),
  ...["USDSGD","USDHKD","USDZAR","USDMXN","USDTRY","USDNOK","USDSEK","USDPLN","USDCNH","USDDKK","USDHUF","USDCZK",
      "EURTRY","EURNOK","EURSEK","EURPLN","EURZAR","EURHUF","GBPZAR","GBPSGD","AUDSGD","SGDJPY"].map(s => fx(s, "Forex Exotic", 30)),
  mk("XAUUSD","Logam",100,0.1,2,"USD",3), mk("XAGUSD","Logam",5000,0.01,3,"USD",3), mk("XAUEUR","Logam",100,0.1,2,"EUR",5),
  mk("XPTUSD","Logam",100,0.1,2,"USD",30), mk("XPDUSD","Logam",100,0.1,2,"USD",50),
  mk("US30","Indeks",1,1,2,"USD",2), mk("US500","Indeks",1,0.1,2,"USD",5), mk("NAS100","Indeks",1,1,2,"USD",1.5), mk("US2000","Indeks",1,0.1,2,"USD",3),
  mk("GER40","Indeks",1,1,2,"EUR",1.5), mk("UK100","Indeks",1,1,2,"GBP",1.5), mk("FRA40","Indeks",1,1,2,"EUR",1.5), mk("EU50","Indeks",1,1,2,"EUR",2),
  mk("JP225","Indeks",100,1,0,"JPY",10), mk("AUS200","Indeks",1,1,2,"AUD",2), mk("HK50","Indeks",1,1,2,"HKD",8),
  mk("USOIL","Energi",100,0.01,2,"USD",3), mk("UKOIL","Energi",100,0.01,2,"USD",4), mk("XNGUSD","Energi",10000,0.001,3,"USD",5),
  mk("BTCUSD","Kripto",1,1,2,"USD",20), mk("ETHUSD","Kripto",1,0.1,2,"USD",20), mk("SOLUSD","Kripto",1,0.01,2,"USD",20),
  mk("BNBUSD","Kripto",1,0.1,2,"USD",10), mk("XRPUSD","Kripto",1,0.0001,4,"USD",20), mk("LTCUSD","Kripto",1,0.01,2,"USD",20),
  mk("ADAUSD","Kripto",1,0.0001,4,"USD",20), mk("DOGEUSD","Kripto",1,0.00001,5,"USD",30)
];

// 1 USD = x mata uang (perkiraan; perbarui di Pengaturan → Kurs). USC = akun cent.
const DEFAULT_RATES = { USD:1, USC:1, EUR:0.86, GBP:0.74, JPY:147, CHF:0.80, CAD:1.38, AUD:1.52, NZD:1.70, SGD:1.29, HKD:7.80,
  ZAR:17.6, MXN:18.6, TRY:41.5, NOK:10.1, SEK:9.5, PLN:3.65, CNH:7.15, DKK:6.4, HUF:340, CZK:21, IDR:16400 };

const DEF_SET = {
  balance:1000, ccy:"USD", leverage:500,
  maxRisk:25, warnAt:80, perTrade:2, minRR:1.5, lotStep:0.01,
  dailyLoss:5, weeklyLoss:10, newsWin:30,
  block:true, lossLock:true, corrWarn:true, newsWarn:true, autoBal:true, sound:true, notif:false,
  costs:true, comm:0,
  theme:"dark", onboarded:false, pin:"",
  sb:{ url:"", key:"" }, liveInMeter:true, followMt5Bal:false,
  setups:["Breakout","Pullback","Reversal","Range","Trend follow","News"],
  emotions:["Tenang","Yakin","Ragu","FOMO","Balas dendam","Bosan"]
};

// Kelompok aset yang bergerak mirip (dipakai untuk peringatan korelasi)
const GROUPS = {
  "Indeks AS":["US30","US500","NAS100","US2000"],
  "Indeks Eropa":["GER40","FRA40","EU50","UK100"],
  "Logam mulia":["XAUUSD","XAGUSD","XAUEUR","XPTUSD","XPDUSD"],
  "Minyak":["USOIL","UKOIL"],
  "Kripto":["BTCUSD","ETHUSD","SOLUSD","BNBUSD","XRPUSD","LTCUSD","ADAUSD","DOGEUSD"]
};
// Nama alternatif yang sering dipakai broker
const ALIASES = { GOLD:"XAUUSD", SILVER:"XAGUSD", DJ30:"US30", WS30:"US30", DJI:"US30", DOW:"US30", USA30:"US30",
  USTEC:"NAS100", US100:"NAS100", NDX:"NAS100", USA100:"NAS100", NQ100:"NAS100", SPX500:"US500", SP500:"US500", USA500:"US500", SPX:"US500",
  DE40:"GER40", GER30:"GER40", DAX40:"GER40", DE30:"GER40", XTIUSD:"USOIL", WTI:"USOIL", USOUSD:"USOIL", XBRUSD:"UKOIL", BRENT:"UKOIL",
  UKOUSD:"UKOIL", JPN225:"JP225", NIKKEI:"JP225", FTSE100:"UK100", F40:"FRA40", STOXX50:"EU50", EUSTX50:"EU50", HK33:"HK50", HSI:"HK50" };

const SEG_COLORS = ["#E0B04B","#5AA9E6","#B57BEA","#2BC4A0","#F07C8A","#F2A33A","#7FD1D9","#E77FB3","#9DB4FF","#C8D96F"];
const DAYS = ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"];

/* ================================================================
 * 2. PENYIMPANAN
 * ================================================================ */
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };
const lsDel = k => { try { localStorage.removeItem(k); } catch (e) {} };

function hash(str) { let h = 5381; for (const ch of String(str)) h = ((h << 5) + h + ch.charCodeAt(0)) | 0; return "h" + (h >>> 0).toString(36); }

function blank() {
  return {
    settings: { ...DEF_SET, sb: { ...DEF_SET.sb }, setups: [...DEF_SET.setups], emotions: [...DEF_SET.emotions], pin: hash("1234") },
    rates: { ...DEFAULT_RATES },
    symbols: DEFAULT_SYMBOLS.map(x => ({ ...x })),
    positions: [], history: [], news: [],
    last: { sym: "XAUUSD" }, updatedAt: 0
  };
}
function normalize(d) {
  const b = blank();
  if (!d || typeof d !== "object") return b;
  const ds = d.settings || {};
  const st = { ...b.settings, ...ds, sb: { ...b.settings.sb, ...(ds.sb || {}) } };
  if (!Array.isArray(st.setups)) st.setups = b.settings.setups;
  if (!Array.isArray(st.emotions)) st.emotions = b.settings.emotions;
  if (!st.pin) st.pin = hash("1234");
  let syms = b.symbols;
  if (Array.isArray(d.symbols) && d.symbols.length) {
    syms = d.symbols.map(x => {
      const def = DEFAULT_SYMBOLS.find(y => y.s === x.s);
      return { swL: 0, swS: 0, ...x, spr: x.spr != null ? x.spr : (def ? def.spr : 0) };
    });
  }
  return {
    settings: st,
    rates: { ...b.rates, ...(d.rates || {}) },
    symbols: syms,
    positions: Array.isArray(d.positions) ? d.positions : [],
    history: Array.isArray(d.history) ? d.history.map(h => h.id ? h : { ...h, id: "h" + Math.random().toString(36).slice(2, 10) }) : [],
    news: Array.isArray(d.news) ? d.news : [],
    last: d.last || b.last,
    updatedAt: +d.updatedAt || 0
  };
}
function load() {
  const v2 = lsGet(KEY), v1 = lsGet(OLD_KEY);
  let d = null;
  try { d = JSON.parse(v2 || v1); } catch (e) {}
  const s = normalize(d);
  if (!v2 && v1 && d) s.settings.onboarded = true; // pengguna versi 1
  return s;
}
let S = load();
function save(opts = {}) {
  S.updatedAt = Date.now();
  if (!lsSet(KEY, JSON.stringify(S))) toast("Gagal menyimpan", "Penyimpanan browser penuh atau diblokir.", "danger");
  resolveCache.clear();
  if (!opts.noSync) Cloud.schedule();
}
const exportData = () => JSON.parse(JSON.stringify(S));

/* ================================================================
 * 3. UTILITAS
 * ================================================================ */
const $ = id => document.getElementById(id);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const num = v => {
  if (v === null || v === undefined || v === "") return NaN;
  const n = parseFloat(String(v).replace(/[\s\u00a0]/g, "").replace(",", "."));
  return isFinite(n) ? n : NaN;
};
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const fmt = (v, dec = 2) => isFinite(v) ? v.toLocaleString("id-ID", { minimumFractionDigits: dec, maximumFractionDigits: dec }) : "—";
const fmtP = (v, d) => isFinite(v) ? (+v).toFixed(d) : "—"; // harga: format MT5 (titik desimal)
const ccyDec = c => (c === "IDR" || c === "JPY" || c === "HUF") ? 0 : 2;
const ccySym = c => ({ USD:"$", EUR:"€", GBP:"£", JPY:"¥", IDR:"Rp ", USC:"¢" }[c] || c + " ");
const money = (v, c = S.settings.ccy) => isFinite(v) ? (v < 0 ? "−" : "") + ccySym(c) + fmt(Math.abs(v), ccyDec(c)) : "—";
const moneyS = v => isFinite(v) ? (v > 0 ? "+" : "") + money(v) : "—";
const pct = (v, d = 2) => isFinite(v) ? fmt(v, d) + "%" : "—";
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const roundLot = (v, step) => +(Math.floor(v / step + 1e-9) * step).toFixed(2);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const randHex = n => { const a = new Uint8Array(n); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => a[i] = Math.random() * 256); return [...a].map(b => b.toString(16).padStart(2, "0")).join(""); };
const toTime = v => typeof v === "number" ? v : new Date(v).getTime();
function relTime(t) {
  const m = Math.round((t - Date.now()) / 60000), a = Math.abs(m);
  const s = a < 60 ? a + " mnt" : a < 1440 ? Math.round(a / 60) + " jam" : Math.round(a / 1440) + " hari";
  return a < 1 ? "sekarang" : m > 0 ? "dalam " + s : s + " lalu";
}
function toAcct(valQuote, q) {
  const rq = S.rates[q], ra = S.rates[S.settings.ccy];
  if (!rq || !ra) return NaN;
  return valQuote / rq * ra;
}

/* ================================================================
 * 4. SIMBOL & PERHITUNGAN INTI
 * ================================================================ */
const resolveCache = new Map();
function resolveSym(raw) {
  if (!raw) return null;
  if (resolveCache.has(raw)) return resolveCache.get(raw);
  let m = S.symbols.find(x => x.s === raw);
  if (!m) {
    const up = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, "");
    m = S.symbols.find(x => x.s === up);
    if (!m) for (const [a, t] of Object.entries(ALIASES)) {
      if (up === a || (up.startsWith(a) && up.length - a.length <= 4)) { m = S.symbols.find(x => x.s === t); if (m) break; }
    }
    if (!m) m = S.symbols.filter(x => up.startsWith(x.s)).sort((a, b) => b.s.length - a.s.length)[0];
    if (!m) m = S.symbols.filter(x => up.endsWith(x.s)).sort((a, b) => b.s.length - a.s.length)[0];
  }
  resolveCache.set(raw, m || null);
  return m || null;
}
const symDigits = raw => (resolveSym(raw) || { d: 5 }).d;

function pnlAt(sym, dir, lot, entry, exit) {
  return toAcct((exit - entry) * (dir === "buy" ? 1 : -1) * sym.cs * lot, sym.q);
}

/** Hitung semua angka untuk satu rencana/posisi. Rugi bernilai negatif. */
function calc(p) {
  const sym = resolveSym(p.sym);
  if (!sym || !(p.lot > 0) || !(p.entry > 0)) return null;
  const st = S.settings, sign = p.dir === "buy" ? 1 : -1, unit = sym.cs * p.lot;
  const r = { sym };
  r.pipVal = toAcct(sym.pip * unit, sym.q);
  r.margin = toAcct(unit * p.entry / st.leverage, sym.q);
  r.spread = st.costs ? (sym.spr || 0) * r.pipVal : 0;
  r.comm = st.costs ? (st.comm || 0) * p.lot : 0;
  r.swap = st.costs ? (p.dir === "buy" ? sym.swL : sym.swS) * p.lot * (p.nights || 0) : 0;
  r.cost = r.spread + r.comm - (r.swap || 0);
  if (isFinite(p.sl)) {
    r.slDist = Math.abs(p.entry - p.sl);
    r.slPips = r.slDist / sym.pip;
    r.slOk = (p.sl - p.entry) * sign < 0;
    r.grossLoss = toAcct((p.sl - p.entry) * sign * unit, sym.q);
    r.loss = r.grossLoss - r.cost;
  }
  if (isFinite(p.tp)) {
    r.tpDist = Math.abs(p.tp - p.entry);
    r.tpPips = r.tpDist / sym.pip;
    r.tpOk = (p.tp - p.entry) * sign > 0;
    r.grossWin = toAcct((p.tp - p.entry) * sign * unit, sym.q);
    r.win = r.grossWin - r.cost;
  }
  if (r.slOk && r.tpOk) { r.rr = r.tpDist / r.slDist; r.netRR = r.win / Math.abs(r.loss); }
  r.risk = r.slOk ? Math.max(0, -r.loss) : NaN;
  return r;
}

/* ---------- Posisi live MT5 ---------- */
const Live = {
  account: null, positions: [], updated: 0, timer: null,
  get stale() { return !this.updated || Date.now() - this.updated > 120000; },
  get connected() { return !!(Cloud.sess && this.updated); },
  items() {
    return this.positions.map(x => ({
      mt5: true, id: "mt5-" + x.ticket, ticket: x.ticket, sym: x.symbol,
      dir: String(x.type).toLowerCase().includes("sell") ? "sell" : "buy",
      lot: +x.volume, entry: +x.price_open, sl: +x.sl > 0 ? +x.sl : NaN, tp: +x.tp > 0 ? +x.tp : NaN,
      cur: +x.price_current, profit: +x.profit, swap: +x.swap,
      lossAtSl: x.loss_at_sl != null ? +x.loss_at_sl : NaN, winAtTp: x.profit_at_tp != null ? +x.profit_at_tp : NaN
    }));
  },
  start() { this.stop(); if (!Cloud.sess || !Cloud.cfg()) return; this.poll(); this.timer = setInterval(() => this.poll(), 15000); },
  stop() { clearInterval(this.timer); this.timer = null; },
  reset() { this.stop(); this.account = null; this.positions = []; this.updated = 0; onDataChange(); },
  async poll() {
    if (!Cloud.sess) return;
    try {
      const rows = await Cloud.req(`/rest/v1/riskdesk_mt5?select=account,positions,updated_at&user_id=eq.${Cloud.sess.user.id}`);
      const r = rows && rows[0];
      if (!r) return;
      this.account = r.account || null;
      this.positions = Array.isArray(r.positions) ? r.positions : [];
      this.updated = r.account ? new Date(r.updated_at).getTime() : 0;
      const bal = this.account ? +this.account.balance : NaN;
      if (S.settings.followMt5Bal && bal > 0 && Math.abs(bal - S.settings.balance) > 0.005) { S.settings.balance = bal; save(); }
      onDataChange();
    } catch (e) { console.warn("Live MT5:", e.message); }
  }
};

/** Risiko satu posisi (manual atau live). */
function riskInfo(p) {
  if (p.mt5) {
    if (!isFinite(p.sl)) return { risk: NaN, noSl: true };
    if (isFinite(p.lossAtSl)) return { risk: Math.max(0, -p.lossAtSl), locked: p.lossAtSl >= 0, win: p.winAtTp };
    const r = calc({ ...p, nights: 0 });
    if (!r) return { risk: NaN, unknown: true };
    return { risk: r.slOk ? Math.max(0, -r.grossLoss) : 0, locked: !r.slOk, win: r.grossWin };
  }
  const r = calc(p);
  return { risk: r ? r.risk : NaN, win: r ? r.win : NaN, rr: r ? r.rr : NaN };
}
function riskItems() {
  const items = S.positions.map((p, i) => ({ p, color: SEG_COLORS[i % SEG_COLORS.length], ...riskInfo(p) }));
  if (S.settings.liveInMeter && Live.connected) {
    Live.items().forEach((p, i) => items.push({ p, live: true, color: SEG_COLORS[(S.positions.length + i) % SEG_COLORS.length], ...riskInfo(p) }));
  }
  return items;
}
const totalRisk = () => riskItems().reduce((a, it) => a + (isFinite(it.risk) ? it.risk : 0), 0);

/* ---------- Batas rugi harian / mingguan ---------- */
function startOfDay() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
function startOfWeek() { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d.getTime(); }
const realizedSince = t => S.history.reduce((a, h) => a + (toTime(h.closed) >= t ? (+h.pnl || 0) : 0), 0);
function lossLimits() {
  const st = S.settings, bal = st.balance;
  const dNet = realizedSince(startOfDay()), wNet = realizedSince(startOfWeek());
  const dBase = st.autoBal ? bal - dNet : bal, wBase = st.autoBal ? bal - wNet : bal;
  const dLim = dBase * st.dailyLoss / 100, wLim = wBase * st.weeklyLoss / 100;
  const dUsed = Math.max(0, -dNet), wUsed = Math.max(0, -wNet);
  const dHit = dLim > 0 && dUsed >= dLim, wHit = wLim > 0 && wUsed >= wLim;
  return { dNet, wNet, dLim, wLim, dUsed, wUsed, dLeft: dLim - dUsed, wLeft: wLim - wUsed, dHit, wHit, locked: st.lossLock && (dHit || wHit) };
}

/* ---------- Korelasi / paparan ---------- */
function legs(sym, dir) {
  const sg = dir === "buy" ? 1 : -1, out = [];
  if (/^(Forex|Logam)/.test(sym.c) && sym.s.length === 6) { out.push({ k: sym.s.slice(0, 3), sg }); out.push({ k: sym.s.slice(3), sg: -sg }); }
  for (const [g, list] of Object.entries(GROUPS)) if (list.includes(sym.s)) out.push({ k: g, sg });
  if (!out.length) out.push({ k: sym.s, sg });
  return out;
}
function exposureMap(list) {
  const map = {};
  list.forEach(it => {
    const sym = resolveSym(it.p.sym); if (!sym) return;
    legs(sym, it.p.dir).forEach(l => {
      const e = map[l.k] = map[l.k] || { k: l.k, long: 0, short: 0, risk: 0 };
      l.sg > 0 ? e.long++ : e.short++;
      e.risk += isFinite(it.risk) ? it.risk : 0;
    });
  });
  return map;
}

/* ---------- Berita ---------- */
function newsCcys(sym) {
  if (/^(Forex|Logam)/.test(sym.c) && sym.s.length === 6) return [sym.s.slice(0, 3), sym.s.slice(3)];
  return [sym.q];
}
function newsHits(sym) {
  const cc = newsCcys(sym), now = Date.now(), win = S.settings.newsWin * 60000;
  const rel = S.news.filter(n => cc.includes(n.ccy) && n.imp !== "low");
  return {
    now: rel.filter(n => Math.abs(n.t - now) <= win).sort((a, b) => a.t - b.t),
    soon: rel.filter(n => n.t - now > win && n.t - now <= 4 * 3600000).sort((a, b) => a.t - b.t)
  };
}

/* ================================================================
 * 5. KERANGKA UI: navigasi, tema, toast, dialog
 * ================================================================ */
const TITLES = { dash:"Dashboard", pos:"Posisi", journal:"Jurnal", stats:"Analitik", tools:"Alat bantu", news:"Kalender berita", settings:"Pengaturan" };
let curView = "dash";
function go(v) {
  if (!TITLES[v]) v = "dash";
  curView = v;
  $$(".nav-btn").forEach(b => b.classList.toggle("on", b.dataset.view === v));
  $$(".view").forEach(s => s.classList.toggle("on", s.id === "v-" + v));
  $("viewTitle").textContent = TITLES[v];
  if (v === "pos") renderPositions();
  if (v === "journal") renderHistory();
  if (v === "stats") renderStats();
  if (v === "tools") { renderPartial(); if (!$("smBal").value) $("smBal").value = S.settings.balance; }
  if (v === "news") renderNews();
  if (v === "settings") showSettings();
  try { history.replaceState(null, "", "#" + v); } catch (e) {}
  window.scrollTo(0, 0);
}
$$(".nav-btn").forEach(b => b.addEventListener("click", () => go(b.dataset.view)));
document.addEventListener("click", e => { const g = e.target.closest("[data-go]"); if (g) go(g.dataset.go); });

const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>';
function applyTheme() {
  const t = S.settings.theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = t;
  $("themeBtn").innerHTML = t === "dark" ? SUN : MOON;
  const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = t === "dark" ? "#0E1726" : "#F2F4F8";
}
$("themeBtn").onclick = () => { S.settings.theme = S.settings.theme === "light" ? "dark" : "light"; save(); applyTheme(); renderStats(); };

function toast(title, body, kind = "") {
  const el = document.createElement("div");
  el.className = "toast " + kind;
  el.innerHTML = `<b>${esc(title)}</b>${esc(body)}`;
  $("toasts").appendChild(el);
  setTimeout(() => el.remove(), kind === "danger" ? 7000 : 4200);
}
let actx;
function beep(danger) {
  if (!S.settings.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    (danger ? [880, 660, 880] : [660]).forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain(), t0 = actx.currentTime + i * 0.18;
      o.frequency.value = f; o.type = "sine";
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.2, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
      o.connect(g).connect(actx.destination); o.start(t0); o.stop(t0 + 0.17);
    });
  } catch (e) {}
}
function notify(title, body, kind) {
  toast(title, body, kind); beep(kind === "danger");
  if (S.settings.notif && "Notification" in window && Notification.permission === "granted") {
    try { new Notification("RiskDesk: " + title, { body, icon: "icon-192.png" }); } catch (e) {}
  }
}

/** Dialog serbaguna. Mengembalikan objek nilai input [name], atau null bila batal. */
function ask({ title, body, ok = "Simpan", danger = false }) {
  return new Promise(res => {
    const m = $("askModal");
    $("askTitle").textContent = title;
    $("askBody").innerHTML = body;
    $("askOk").textContent = ok;
    $("askOk").className = "btn " + (danger ? "danger-solid" : "primary");
    m.classList.add("open");
    const first = m.querySelector("#askBody input, #askBody select, #askBody textarea");
    setTimeout(() => (first || $("askOk")).focus(), 60);
    const done = v => { m.classList.remove("open"); $("askOk").onclick = $("askCancel").onclick = m.onkeydown = m.onclick = null; res(v); };
    $("askOk").onclick = () => { const vals = {}; $$("[name]", $("askBody")).forEach(i => vals[i.name] = i.type === "checkbox" ? i.checked : i.value); done(vals); };
    $("askCancel").onclick = () => done(null);
    m.onclick = e => { if (e.target === m) done(null); };
    m.onkeydown = e => {
      if (e.key === "Escape") done(null);
      if (e.key === "Enter" && e.target.tagName !== "TEXTAREA" && e.target.tagName !== "BUTTON") { e.preventDefault(); $("askOk").click(); }
    };
  });
}
const confirmBox = (title, text, ok = "Lanjutkan", danger = true) => ask({ title, body: `<p class="c-muted" style="margin:0">${esc(text)}</p>`, ok, danger }).then(v => !!v);

/* ---------- Jam & sesi pasar ---------- */
const SESS = [["Sydney", 21, 6], ["Tokyo", 0, 9], ["London", 7, 16], ["New York", 12, 21]];
function tick() {
  const now = new Date(), h = now.getUTCHours() + now.getUTCMinutes() / 60;
  const wd = now.getUTCDay(), weekend = wd === 6 || (wd === 0 && h < 21) || (wd === 5 && h >= 21);
  $("sessions").innerHTML = weekend ? `<span class="sess"><i></i>Pasar forex tutup</span>` : SESS.map(([n, a, b]) => {
    const on = a < b ? (h >= a && h < b) : (h >= a || h < b);
    return `<span class="sess ${on ? "on" : ""}"><i></i>${n}</span>`;
  }).join("");
  let tz = "";
  try { tz = new Intl.DateTimeFormat("id-ID", { timeZoneName: "short" }).formatToParts(now).find(p => p.type === "timeZoneName").value; } catch (e) {}
  $("clock").textContent = now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) + (tz ? " " + tz : "");
}

/* ================================================================
 * 6. KALKULATOR
 * ================================================================ */
let dir = "buy", curEmo = "";
let curSym = resolveSym(S.last.sym) ? resolveSym(S.last.sym).s : "XAUUSD";

function readForm() {
  return { sym: curSym, dir, lot: num($("lot").value), entry: num($("entry").value), sl: num($("sl").value), tp: num($("tp").value),
    nights: Math.max(0, num($("nights").value) || 0), setup: $("setup").value, emo: curEmo, note: $("note").value.trim() };
}

/* ---------- Pemilih simbol ---------- */
const symInput = $("symInput"), symList = $("symList");
let comboIdx = -1;
function renderCombo(q = "") {
  q = q.toUpperCase().trim();
  const groups = {};
  S.symbols.filter(x => !q || x.s.includes(q) || x.c.toUpperCase().includes(q)).forEach(x => (groups[x.c] = groups[x.c] || []).push(x));
  let html = "";
  for (const g in groups) {
    html += `<div class="combo-group">${esc(g)}</div>`;
    groups[g].forEach(x => { html += `<div class="combo-item" role="option" data-s="${esc(x.s)}">${esc(x.s)}<span>${esc(x.q)}</span></div>`; });
  }
  symList.innerHTML = html || `<div class="empty">Simbol tidak ditemukan. Tambahkan di Pengaturan → Simbol.</div>`;
  comboIdx = -1;
}
function openCombo(open) { symList.classList.toggle("open", open); symInput.setAttribute("aria-expanded", open); }
function pickSym(s) {
  const sym = resolveSym(s) || S.symbols[0];
  curSym = sym.s; S.last.sym = sym.s; save({ noSync: true });
  symInput.value = sym.s; openCombo(false);
  ["entry", "sl", "tp", "pcTp1"].forEach(id => $(id).step = Math.pow(10, -sym.d));
  $("symInfo").textContent = `Contract ${fmt(sym.cs, 0)} · 1 pip = ${sym.pip} · kutipan ${sym.q} · spread ±${fmt(sym.spr, 1)} pip`;
  update();
}
symInput.addEventListener("focus", () => { renderCombo(""); symInput.select(); openCombo(true); });
symInput.addEventListener("input", () => { renderCombo(symInput.value); openCombo(true); });
symInput.addEventListener("keydown", e => {
  const its = $$(".combo-item", symList);
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    comboIdx = clamp(comboIdx + (e.key === "ArrowDown" ? 1 : -1), 0, its.length - 1);
    its.forEach((el, i) => el.classList.toggle("act", i === comboIdx));
    its[comboIdx] && its[comboIdx].scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter") {
    e.preventDefault(); const el = its[comboIdx] || its[0]; if (el) { pickSym(el.dataset.s); $("entry").focus(); }
  } else if (e.key === "Escape") { openCombo(false); symInput.value = curSym; }
});
symList.addEventListener("mousedown", e => { const el = e.target.closest(".combo-item"); if (el) { e.preventDefault(); pickSym(el.dataset.s); } });
symInput.addEventListener("blur", () => setTimeout(() => { openCombo(false); symInput.value = curSym; }, 120));

/* ---------- Input lain ---------- */
function setDir(d) { dir = d; $("dirBuy").classList.toggle("on", d === "buy"); $("dirSell").classList.toggle("on", d === "sell"); syncPipFields(); update(); }
$("dirBuy").onclick = () => setDir("buy");
$("dirSell").onclick = () => setDir("sell");
$$("[data-lot]").forEach(b => b.onclick = () => {
  const st = S.settings.lotStep || 0.01;
  $("lot").value = +Math.max(st, (num($("lot").value) || 0) + st * +b.dataset.lot).toFixed(2);
  update();
});
["lot", "tp", "nights", "note", "riskVal"].forEach(id => $(id).addEventListener("input", update));
$("entry").addEventListener("input", () => { syncPipFields(); update(); });
$("sl").addEventListener("input", update);
$("riskMode").addEventListener("change", update);
$("setup").addEventListener("change", update);
function pipsToPrice(which) {
  const sym = resolveSym(curSym), e = num($("entry").value), p = num($(which + "Pips").value);
  if (!isFinite(e) || !isFinite(p)) return;
  const sign = (dir === "buy") === (which === "tp") ? 1 : -1;
  $(which).value = (e + sign * p * sym.pip).toFixed(sym.d);
  update();
}
// Saat entry/arah berubah dan kolom pip terisi, harga SL/TP ikut dihitung ulang
function syncPipFields() { if ($("slPips").value) pipsToPrice("sl"); if ($("tpPips").value) pipsToPrice("tp"); }
$("slPips").addEventListener("input", () => pipsToPrice("sl"));
$("tpPips").addEventListener("input", () => pipsToPrice("tp"));
$("sl").addEventListener("input", () => { $("slPips").value = ""; });
$("tp").addEventListener("input", () => { $("tpPips").value = ""; });

function renderTagInputs() {
  $("setup").innerHTML = `<option value="">— Pilih setup —</option>` + S.settings.setups.map(s => `<option>${esc(s)}</option>`).join("");
  $("emoChips").innerHTML = S.settings.emotions.map(e => `<button type="button" data-emo="${esc(e)}" class="${e === curEmo ? "on" : ""}">${esc(e)}</button>`).join("");
}
$("emoChips").addEventListener("click", e => {
  const b = e.target.closest("[data-emo]"); if (!b) return;
  curEmo = curEmo === b.dataset.emo ? "" : b.dataset.emo;
  $$("[data-emo]").forEach(x => x.classList.toggle("on", x.dataset.emo === curEmo));
});

/* ---------- Tiket hasil ---------- */
let lastSizerLot = NaN;
function update() {
  const p = readForm(), st = S.settings, sym = resolveSym(curSym), bal = st.balance;
  $("tSym").textContent = curSym;
  $("tDir").textContent = `${dir.toUpperCase()} ${isFinite(p.lot) ? p.lot : ""}`;
  $("tDir").className = "badge " + dir;

  const r = calc(p);
  const errs = [];
  $("sl").classList.toggle("bad", !!(r && isFinite(p.sl) && !r.slOk));
  $("tp").classList.toggle("bad", !!(r && isFinite(p.tp) && !r.tpOk));
  if (r && isFinite(p.sl) && !r.slOk) errs.push(dir === "buy" ? "SL untuk Buy harus di bawah harga entry." : "SL untuk Sell harus di atas harga entry.");
  if (r && isFinite(p.tp) && !r.tpOk) errs.push(dir === "buy" ? "TP untuk Buy harus di atas harga entry." : "TP untuk Sell harus di bawah harga entry.");
  $("calcErr").textContent = errs.join(" ");

  const okSl = r && r.slOk, okTp = r && r.tpOk;
  $("tLoss").textContent = okSl ? money(r.loss) : "—";
  $("tLossPct").textContent = okSl ? `${pct(Math.abs(r.loss) / bal * 100)} modal${r.cost ? " · kotor " + money(r.grossLoss) : ""}` : "Isi entry & SL";
  $("tWin").textContent = okTp ? money(r.win) : "—";
  $("tWinPct").textContent = okTp ? `${pct(r.win / bal * 100)} modal${r.cost ? " · kotor " + money(r.grossWin) : ""}` : "Isi entry & TP";
  $("tDist").textContent = r ? `${okSl ? fmt(r.slPips, 1) : "—"} / ${okTp ? fmt(r.tpPips, 1) : "—"} pip` : "—";
  $("tPipVal").textContent = r ? money(r.pipVal) : "—";
  $("tCost").textContent = r ? (st.costs ? money(r.cost) : "Tidak dihitung") : "—";
  $("tMargin").textContent = r ? `${money(r.margin)} · ${pct(r.margin / bal * 100, 1)}` : "—";

  const rr = okSl && okTp ? r.netRR : NaN;
  $("rrTxt").textContent = isFinite(rr) ? `R:R 1 : ${fmt(rr, 2)}` : "R:R —";
  const rp = isFinite(rr) ? 100 / (1 + rr) : 50;
  $("rrRisk").style.width = rp + "%"; $("rrRew").style.width = (100 - rp) + "%";
  $("tBE").textContent = isFinite(rr) ? pct(100 / (1 + rr), 1) : "—";

  const used = totalRisk(), lim = lossLimits();
  const newRisk = okSl ? r.risk : 0;
  const after = (used + newRisk) / bal * 100;
  $("tAfter").textContent = okSl ? pct(after) : "—";
  $("tDayLeft").textContent = st.dailyLoss > 0 ? money(Math.max(0, lim.dLeft)) : "—";

  /* Checklist */
  const checks = [];
  if (lim.locked) checks.push(["bad", `Batas rugi ${lim.dHit ? "harian" : "mingguan"} sudah tercapai. Entry dikunci sampai ${lim.dHit ? "besok" : "minggu depan"}.`]);
  if (r && !isFinite(p.sl)) checks.push(["bad", "Belum ada stop loss. Risiko tidak terbatas."]);
  if (okSl) {
    const tr = r.risk / bal * 100;
    checks.push([tr <= st.perTrade ? "" : "bad", `Risiko trade ini ${pct(tr)} (maks ${st.perTrade}%)`]);
    checks.push([after < st.maxRisk * st.warnAt / 100 ? "" : after <= st.maxRisk ? "mid" : "bad", `Total risiko menjadi ${pct(after)} dari batas ${st.maxRisk}%`]);
    if (st.dailyLoss > 0 && !lim.locked && r.risk > lim.dLeft) checks.push(["mid", `Jika SL kena, batas rugi harian ${st.dailyLoss}% terlewati`]);
  }
  if (isFinite(rr)) checks.push([rr >= st.minRR ? "" : "mid", `R:R bersih 1:${fmt(rr, 2)} (minimum 1:${fmt(st.minRR, 1)})`]);
  if (r && isFinite(r.margin) && r.margin > bal * 0.5) checks.push(["mid", `Margin memakan ${pct(r.margin / bal * 100, 0)} modal`]);
  if (st.corrWarn && sym && r) {
    const ex = exposureMap(riskItems());
    const same = legs(sym, dir).filter(l => ex[l.k] && (l.sg > 0 ? ex[l.k].long : ex[l.k].short) > 0);
    if (same.length) {
      const n = Math.max(...same.map(l => l.sg > 0 ? ex[l.k].long : ex[l.k].short));
      checks.push(["mid", `Searah dengan ${n} posisi lain (${same.map(l => (l.sg > 0 ? "long " : "short ") + l.k).join(", ")}). Risiko efektif bertumpuk.`]);
    }
  }
  if (st.newsWarn && sym) {
    const nh = newsHits(sym);
    nh.now.forEach(n => checks.push(["bad", `Berita ${n.ccy} "${n.title}" ${relTime(n.t)}. Hindari entry ±${st.newsWin} menit.`]));
    if (!nh.now.length && nh.soon[0]) checks.push(["info", `Berita ${nh.soon[0].ccy} "${nh.soon[0].title}" ${relTime(nh.soon[0].t)}`]);
  }
  $("checks").innerHTML = checks.map(([c, t]) => `<li class="${c}">${esc(t)}</li>`).join("");

  const overCap = st.block && okSl && after > st.maxRisk;
  const valid = okSl && (!isFinite(p.tp) || okTp);
  $("addPos").disabled = !valid || overCap || lim.locked;
  $("addPos").textContent = lim.locked ? "Entry dikunci: batas rugi tercapai" : overCap ? `Ditolak: melewati batas ${st.maxRisk}%` : "Tambahkan ke posisi";

  /* Penghitung lot */
  const rv = num($("riskVal").value);
  const riskAmt = $("riskMode").value === "pct" ? bal * rv / 100 : rv;
  lastSizerLot = NaN;
  if (okSl && riskAmt > 0) {
    const perLot = calc({ ...p, lot: 1 });
    const lossPerLot = Math.abs(perLot.loss);
    const step = st.lotStep || 0.01;
    lastSizerLot = roundLot(riskAmt / lossPerLot, step);
    if (lastSizerLot >= step) {
      $("sizerLot").textContent = fmt(lastSizerLot, 2);
      $("sizerAmt").textContent = `≈ risiko ${money(lastSizerLot * lossPerLot)}`;
    } else { $("sizerLot").textContent = "< " + step; $("sizerAmt").textContent = "SL terlalu lebar untuk risiko ini"; }
  } else { $("sizerLot").textContent = "—"; $("sizerAmt").textContent = "Isi entry & SL dulu"; }
  $("useLot").disabled = !(lastSizerLot >= (st.lotStep || 0.01));

  renderBudget(okSl ? r.risk : 0);
  if (curView === "tools") renderPartial();
}
$("useLot").onclick = () => { if (lastSizerLot > 0) { $("lot").value = lastSizerLot; update(); } };

/* ================================================================
 * 7. METER RISIKO & PERINGATAN
 * ================================================================ */
let lastLevel = null;
function riskLevel(usedPct, lim) {
  const st = S.settings;
  if (lim.locked) return "locked";
  if (usedPct >= st.maxRisk) return "danger";
  if (usedPct >= st.maxRisk * st.warnAt / 100) return "warn";
  return "ok";
}
function renderBudget(preview = 0) {
  const st = S.settings, bal = st.balance, items = riskItems();
  const used = items.reduce((a, it) => a + (isFinite(it.risk) ? it.risk : 0), 0), usedPct = used / bal * 100;
  const scaleMax = Math.max(st.maxRisk * 1.4, usedPct + preview / bal * 100 + 2);
  const lim = lossLimits(), level = riskLevel(usedPct, lim);
  $("riskPct").innerHTML = `${pct(usedPct)}<small>dari batas ${st.maxRisk}%</small>`;
  $("riskPct").style.color = level === "danger" || level === "locked" ? "var(--sell)" : level === "warn" ? "var(--warn)" : "var(--text)";
  $("bBalance").textContent = money(bal);
  $("bUsed").textContent = money(used);
  $("bLeft").textContent = money(Math.max(0, bal * st.maxRisk / 100 - used));
  $("bCount").textContent = items.length;

  let segs = items.map(it => {
    const w = isFinite(it.risk) ? it.risk / bal * 100 / scaleMax * 100 : 0;
    const lbl = `${it.p.sym} ${it.p.dir.toUpperCase()} ${it.p.lot} lot${it.live ? " (MT5)" : ""}: ${isFinite(it.risk) ? money(it.risk) : "tanpa SL"}`;
    return `<div class="seg${it.live ? " live" : ""}" title="${esc(lbl)}" style="width:${w}%;background-color:${it.color}"></div>`;
  }).join("");
  if (preview > 0) segs += `<div class="seg preview" title="Rencana entry saat ini" style="width:${preview / bal * 100 / scaleMax * 100}%"></div>`;
  $("meterFill").innerHTML = segs;
  $("wall").style.left = (st.maxRisk / scaleMax * 100) + "%";
  $("wall").dataset.label = `Batas ${st.maxRisk}%`;
  $("warnLine").style.left = (st.maxRisk * st.warnAt / 100 / scaleMax * 100) + "%";
  $("meterScale").innerHTML = [0, .25, .5, .75, 1].map(f => `<span>${fmt(scaleMax * f, 1)}%</span>`).join("");

  const setBar = (bar, txt, usedAmt, limAmt, limPct) => {
    const f = limAmt > 0 ? usedAmt / limAmt : 0;
    $(bar).style.width = clamp(f * 100, 0, 100) + "%";
    $(bar).style.background = f >= 1 ? "var(--sell)" : f >= .7 ? "var(--warn)" : "var(--buy)";
    $(txt).textContent = limPct > 0 ? `${money(usedAmt)} / ${money(limAmt)}` : "Tidak dibatasi";
  };
  setBar("dayBar", "dayTxt", lim.dUsed, lim.dLim, st.dailyLoss);
  setBar("weekBar", "weekTxt", lim.wUsed, lim.wLim, st.weeklyLoss);

  const noSl = items.filter(it => it.noSl).length;
  let text;
  if (level === "locked") text = `Batas rugi ${lim.dHit ? "harian" : "mingguan"} tercapai (${money(lim.dHit ? lim.dUsed : lim.wUsed)}). Entry baru dikunci. Istirahat dulu, evaluasi jurnal.`;
  else if (level === "danger") text = `Total SL sudah ${pct(usedPct)} dari modal, melewati batas ${st.maxRisk}%. Kurangi lot atau tutup sebagian posisi.`;
  else if (level === "warn") text = `Mendekati batas: total SL ${pct(usedPct)}. Sisa ruang risiko ${money(bal * st.maxRisk / 100 - used)}.`;
  else if (!items.length) text = "Belum ada posisi. Isi rencana entry di bawah untuk mulai mengukur risiko.";
  else text = `Aman. Total SL ${pct(usedPct)} dari modal, di bawah batas ${st.maxRisk}%.`;
  if (noSl) text += ` ${noSl} posisi MT5 tanpa SL tidak bisa diukur.`;
  $("budgetMsg").className = "budget-msg " + (noSl && level === "ok" ? "warn" : level);
  $("budgetMsg").textContent = text;

  if (lastLevel !== null && level !== lastLevel && level !== "ok") {
    const titles = { warn: "Mendekati batas risiko", danger: `Batas risiko ${st.maxRisk}% tersentuh`, locked: "Batas rugi tercapai" };
    notify(titles[level], level === "locked" ? "Entry baru dikunci untuk melindungi modal." : `Total SL semua posisi = ${pct(usedPct)} dari modal.`, level === "warn" ? "warn" : "danger");
  }
  lastLevel = level;
  $("navPosN").textContent = items.length || "";
}

/* ---------- Paparan & berita di dashboard ---------- */
function renderExposure() {
  const ex = Object.values(exposureMap(riskItems())).filter(e => e.long + e.short > 0)
    .sort((a, b) => Math.max(b.long, b.short) - Math.max(a.long, a.short) || b.risk - a.risk);
  if (!ex.length) { $("exposure").innerHTML = `<p class="empty">Belum ada posisi. Paparan muncul setelah Anda menambah posisi.</p>`; return; }
  $("exposure").innerHTML = ex.slice(0, 8).map(e => {
    const net = e.long - e.short, hot = e.long >= 2 || e.short >= 2;
    const pill = net > 0 ? `<span class="pill buy">Long ${e.long}</span>` : net < 0 ? `<span class="pill sell">Short ${e.short}</span>` : `<span class="pill neu">Netral</span>`;
    return `<div class="expo-row${hot ? " hot" : ""}"><b>${esc(e.k)}</b>${pill}<span class="num c-muted">${money(e.risk)}</span></div>`;
  }).join("") + (ex.some(e => e.long >= 2 || e.short >= 2) ? `<p class="hint" style="margin-top:10px">Baris berwarna kuning berarti ada 2 posisi atau lebih yang searah.</p>` : "");
}
function renderNewsSoon() {
  const now = Date.now();
  const list = S.news.filter(n => n.imp !== "low" && n.t > now - S.settings.newsWin * 60000 && n.t < now + 7 * 864e5).sort((a, b) => a.t - b.t).slice(0, 5);
  const hot = S.news.filter(n => n.imp === "high" && Math.abs(n.t - now) < 24 * 3600000 && n.t > now).length;
  $("navNewsN").textContent = hot || "";
  if (!list.length) { $("newsSoon").innerHTML = `<p class="empty">Belum ada jadwal berita minggu ini. Tambahkan di menu Berita.</p>`; return; }
  $("newsSoon").innerHTML = list.map(newsRow).join("");
}
function newsRow(n, withDel) {
  const now = Date.now(), d = new Date(n.t), win = S.settings.newsWin * 60000;
  const cls = n.t < now - win ? "past" : Math.abs(n.t - now) <= win ? "now" : "";
  const impTxt = { high: "Tinggi", med: "Sedang", low: "Rendah" }[n.imp];
  return `<div class="news-row ${cls}"><time>${d.toLocaleDateString("id-ID", { weekday: "short", day: "2-digit", month: "short" })}<br>${d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</time>
    <div class="t"><b>${esc(n.ccy)} · ${esc(n.title)}</b><small>${relTime(n.t)}</small></div>
    <div class="actions"><span class="pill ${n.imp}">${impTxt}</span>${withDel ? `<button class="btn sm ghost" data-ndel="${esc(n.id)}" aria-label="Hapus berita">✕</button>` : ""}</div></div>`;
}

/** Dipanggil setiap kali data posisi/riwayat/live berubah. */
function onDataChange() {
  update(); renderExposure(); renderNewsSoon();
  if (curView === "pos") renderPositions();
  if (curView === "journal") renderHistory();
  if (curView === "stats") renderStats();
}

/* ================================================================
 * 8. POSISI
 * ================================================================ */
$("addPos").onclick = () => {
  const p = readForm(), r = calc(p);
  if (!r || !r.slOk) return;
  const pos = { ...p, id: uid(), time: new Date().toISOString() };
  S.positions.push(pos); save();
  toast("Posisi ditambahkan", `${p.sym} ${p.dir.toUpperCase()} ${p.lot} lot · risiko ${money(r.risk)}`, "ok");
  onDataChange();
};

function renderPositions() {
  const body = $("posBody");
  if (!S.positions.length) body.innerHTML = `<tr><td colspan="11" class="empty">Belum ada posisi manual. Tambahkan dari kalkulator di Dashboard.</td></tr>`;
  else body.innerHTML = S.positions.map((p, i) => {
    const r = calc(p), d = symDigits(p.sym);
    return `<tr>
      <td class="num"><span class="dot" style="background:${SEG_COLORS[i % SEG_COLORS.length]}"></span>${esc(p.sym)}</td>
      <td><span class="pill ${p.dir}">${p.dir.toUpperCase()}</span></td>
      <td class="num">${p.lot}</td>
      <td class="num">${fmtP(p.entry, d)}</td><td class="num">${fmtP(p.sl, d)}</td><td class="num">${isFinite(p.tp) ? fmtP(p.tp, d) : "—"}</td>
      <td class="num c-sell">${r ? money(-r.risk) : "—"}</td>
      <td class="num c-buy">${r && isFinite(r.win) ? money(r.win) : "—"}</td>
      <td class="num">${r && isFinite(r.netRR) ? "1:" + fmt(r.netRR, 2) : "—"}</td>
      <td>${esc(p.setup) || '<span class="c-muted">—</span>'}</td>
      <td><div class="actions">
        <button class="btn sm" data-close="tp" data-id="${p.id}" ${isFinite(p.tp) ? "" : "disabled"}>TP</button>
        <button class="btn sm" data-close="sl" data-id="${p.id}">SL</button>
        <button class="btn sm" data-close="manual" data-id="${p.id}">Harga lain</button>
        <button class="btn sm ghost" data-close="del" data-id="${p.id}" title="Hapus tanpa mencatat" aria-label="Hapus tanpa mencatat">✕</button>
      </div></td></tr>`;
  }).join("");
  renderLive();
}

$("posBody").addEventListener("click", async e => {
  const b = e.target.closest("[data-close]"); if (!b) return;
  const idx = S.positions.findIndex(p => p.id === b.dataset.id); if (idx < 0) return;
  const p = S.positions[idx], mode = b.dataset.close;
  if (mode === "del") {
    if (!(await confirmBox("Hapus posisi?", `${p.sym} ${p.dir.toUpperCase()} ${p.lot} lot akan dihapus tanpa dicatat ke jurnal.`, "Hapus"))) return;
    S.positions.splice(idx, 1); save(); onDataChange(); return;
  }
  let exit = mode === "tp" ? p.tp : mode === "sl" ? p.sl : NaN;
  if (mode === "manual") {
    const v = await ask({ title: `Tutup ${p.sym}`, ok: "Tutup posisi",
      body: `<div class="field"><label>Harga penutupan</label><input name="exit" type="number" step="any" class="num" value="${p.entry}"></div>` });
    if (!v) return;
    exit = num(v.exit);
    if (!isFinite(exit)) { toast("Harga tidak valid", "Masukkan angka harga penutupan.", "danger"); return; }
  }
  closePosition(idx, exit, mode === "tp" ? "TP" : mode === "sl" ? "SL" : "Manual");
});

function closePosition(idx, exit, result) {
  const p = S.positions[idx], sym = resolveSym(p.sym), r = calc(p);
  const pnl = pnlAt(sym, p.dir, p.lot, p.entry, exit) - (r ? r.cost : 0);
  S.history.unshift({ ...p, exit, pnl, risk: r ? r.risk : NaN, result, opened: p.time, closed: new Date().toISOString(), src: "manual" });
  S.positions.splice(idx, 1);
  if (S.settings.autoBal) S.settings.balance = +(S.settings.balance + pnl).toFixed(2);
  save();
  toast(pnl >= 0 ? "Posisi ditutup profit" : "Posisi ditutup rugi", `${p.sym}: ${moneyS(pnl)}`, pnl >= 0 ? "ok" : "warn");
  onDataChange();
}
$("clearPos").onclick = async () => {
  if (!S.positions.length) return;
  if (await confirmBox("Hapus semua posisi manual?", "Posisi akan dihapus tanpa dicatat ke jurnal.", "Hapus semua")) { S.positions = []; save(); onDataChange(); }
};

function renderLive() {
  const chip = $("liveChip"), acct = Live.account;
  if (!Cloud.sess) { chip.className = "chip"; chip.innerHTML = "<i></i>Tidak terhubung"; }
  else if (!Live.updated) { chip.className = "chip warn"; chip.innerHTML = "<i></i>Menunggu EA"; }
  else if (Live.stale) { chip.className = "chip err"; chip.innerHTML = "<i></i>EA tidak aktif"; }
  else { chip.className = "chip ok"; chip.innerHTML = "<i></i>Live"; }
  $("liveSub").textContent = !Cloud.sess ? "Masuk ke akun cloud di Pengaturan → Cloud & MT5, lalu pasang EA RiskDesk Bridge di MT5."
    : !Live.updated ? "Akun terhubung. Pasang EA RiskDesk Bridge di MT5 dengan SyncToken dari Pengaturan."
    : `Pembaruan terakhir ${relTime(Live.updated)}${Live.stale ? ". Pastikan MT5 menyala dan EA berjalan." : "."}`;
  $("liveAcct").innerHTML = acct ? [
    ["Akun", `${esc(acct.login || "")} · ${esc(acct.server || "")}`], ["Balance", money(+acct.balance)], ["Equity", money(+acct.equity)],
    ["Margin terpakai", money(+acct.margin)], ["Free margin", money(+acct.margin_free)],
    ["Margin level", +acct.margin > 0 ? pct(acct.equity / acct.margin * 100, 0) : "—"]
  ].map(([k, v]) => `<div class="kpi"><span>${k}</span><b class="num">${v}</b></div>`).join("") : "";
  const items = Live.items();
  if (!items.length) { $("liveBody").innerHTML = `<tr><td colspan="9" class="empty">${Live.updated ? "Tidak ada posisi terbuka di MT5." : "Belum ada data dari MT5."}</td></tr>`; return; }
  $("liveBody").innerHTML = items.map(p => {
    const ri = riskInfo(p), d = symDigits(p.sym);
    const status = ri.noSl ? `<span class="pill high">Tanpa SL</span>` : ri.locked ? `<span class="pill buy">SL di profit</span>` : `<span class="pill neu">Aktif</span>`;
    return `<tr><td class="num">${esc(p.sym)}</td><td><span class="pill ${p.dir}">${p.dir.toUpperCase()}</span></td><td class="num">${p.lot}</td>
      <td class="num">${fmtP(p.entry, d)}</td><td class="num">${isFinite(p.sl) ? fmtP(p.sl, d) : "—"}</td><td class="num">${isFinite(p.tp) ? fmtP(p.tp, d) : "—"}</td>
      <td class="num ${p.profit >= 0 ? "c-buy" : "c-sell"}">${moneyS(p.profit)}</td>
      <td class="num c-sell">${isFinite(ri.risk) ? money(-ri.risk) : "∞"}</td><td>${status}</td></tr>`;
  }).join("");
}

/* ================================================================
 * 9. JURNAL
 * ================================================================ */
function periodFilter(list, v) {
  if (v === "all") return list;
  const t = v === "1" ? startOfDay() : Date.now() - (+v) * 864e5;
  return list.filter(h => toTime(h.closed) >= t);
}
const rMult = h => isFinite(h.risk) && h.risk > 0 ? h.pnl / h.risk : NaN;

function renderHistory() {
  const q = $("jSearch").value.trim().toLowerCase();
  const list = periodFilter(S.history, $("jPeriod").value)
    .filter(h => !q || [h.sym, h.setup, h.emo, h.note].join(" ").toLowerCase().includes(q));
  const net = list.reduce((a, h) => a + (+h.pnl || 0), 0);
  $("jCount").innerHTML = list.length ? `${list.length} trade · net <span class="num ${net >= 0 ? "c-buy" : "c-sell"}">${moneyS(net)}</span>` : "Posisi yang ditutup tercatat di sini.";
  if (!list.length) {
    $("histBody").innerHTML = `<tr><td colspan="13" class="empty">${S.history.length ? "Tidak ada trade yang cocok dengan filter." : "Jurnal masih kosong. Tutup posisi lewat menu Posisi, atau import laporan dari MT5."}</td></tr>`;
    return;
  }
  $("histBody").innerHTML = list.slice(0, 500).map(h => {
    const d = symDigits(h.sym), R = rMult(h);
    return `<tr><td class="c-muted">${new Date(h.closed).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}</td>
      <td class="num">${esc(h.sym)}</td><td><span class="pill ${h.dir}">${String(h.dir).toUpperCase()}</span></td>
      <td class="num">${h.lot}</td><td class="num">${fmtP(+h.entry, d)}</td><td class="num">${fmtP(+h.exit, d)}</td>
      <td>${esc(h.result)}${h.src === "mt5" ? ' <span class="pill neu">MT5</span>' : ""}</td>
      <td class="num ${h.pnl >= 0 ? "c-buy" : "c-sell"}">${moneyS(+h.pnl)}</td>
      <td class="num">${isFinite(R) ? fmt(R, 2) + "R" : "—"}</td>
      <td>${esc(h.setup) || '<span class="c-muted">—</span>'}</td><td>${esc(h.emo) || '<span class="c-muted">—</span>'}</td>
      <td class="wrap c-muted">${esc(h.note)}</td>
      <td><div class="actions"><button class="btn sm ghost" data-hedit="${esc(h.id)}" aria-label="Ubah catatan">Ubah</button><button class="btn sm ghost" data-hdel="${esc(h.id)}" aria-label="Hapus">✕</button></div></td></tr>`;
  }).join("");
}
$("jPeriod").addEventListener("change", renderHistory);
$("jSearch").addEventListener("input", renderHistory);
$("histBody").addEventListener("click", async e => {
  const del = e.target.closest("[data-hdel]"), ed = e.target.closest("[data-hedit]");
  if (del) {
    const i = S.history.findIndex(h => h.id === del.dataset.hdel); if (i < 0) return;
    if (!(await confirmBox("Hapus catatan trade?", `${S.history[i].sym} ${moneyS(S.history[i].pnl)} akan dihapus dari jurnal. Modal tidak berubah.`, "Hapus"))) return;
    S.history.splice(i, 1); save(); onDataChange();
  }
  if (ed) {
    const h = S.history.find(x => x.id === ed.dataset.hedit); if (!h) return;
    const opt = (list, cur) => `<option value="">—</option>` + [...new Set([...list, cur].filter(Boolean))].map(s => `<option ${s === cur ? "selected" : ""}>${esc(s)}</option>`).join("");
    const v = await ask({ title: `Ubah catatan ${h.sym}`, body: `
      <div class="row"><div class="field"><label>Setup</label><select name="setup">${opt(S.settings.setups, h.setup)}</select></div>
      <div class="field"><label>Emosi</label><select name="emo">${opt(S.settings.emotions, h.emo)}</select></div></div>
      <div class="field"><label>Catatan / pelajaran</label><textarea name="note">${esc(h.note)}</textarea></div>` });
    if (!v) return;
    Object.assign(h, { setup: v.setup, emo: v.emo, note: v.note.trim() }); save(); onDataChange();
  }
});
$("clearHist").onclick = async () => {
  if (!S.history.length) return;
  if (await confirmBox("Hapus seluruh jurnal?", "Semua catatan trade dan statistik akan hilang. Unduh backup dulu jika perlu.", "Hapus jurnal")) { S.history = []; save(); onDataChange(); }
};

/* ---------- Ekspor ---------- */
const CSV_COLS = ["opened","closed","symbol","direction","lot","entry","sl","tp","exit","result","pnl","risk","setup","emotion","note","source","ticket"];
$("exportCsv").onclick = () => {
  if (!S.history.length) { toast("Jurnal kosong", "Belum ada data untuk diekspor."); return; }
  const rows = [CSV_COLS];
  S.history.forEach(h => rows.push([h.opened || "", h.closed, h.sym, h.dir, h.lot, h.entry, h.sl ?? "", h.tp ?? "", h.exit, h.result,
    (+h.pnl).toFixed(2), isFinite(h.risk) ? (+h.risk).toFixed(2) : "", h.setup || "", h.emo || "", h.note || "", h.src || "", h.ticket || ""]));
  download(`riskdesk-jurnal-${new Date().toISOString().slice(0, 10)}.csv`, "\ufeff" + rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n"), "text/csv");
};
function download(name, content, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
}

/* ---------- Import laporan MT5 / CSV ---------- */
$("importFile").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  try {
    const text = decodeFile(await f.arrayBuffer());
    const rows = /<table/i.test(text) ? parseMt5Html(text) : parseCsvJournal(text);
    if (!rows.length) { toast("Tidak ada trade ditemukan", "Pastikan file adalah laporan History MT5 (HTML) atau CSV dari RiskDesk.", "danger"); return; }
    const seen = new Set(S.history.map(h => h.ticket ? "t" + h.ticket : h.closed + h.sym + h.entry));
    let added = 0, unknown = new Set();
    rows.forEach(h => {
      const k = h.ticket ? "t" + h.ticket : h.closed + h.sym + h.entry;
      if (seen.has(k)) return;
      seen.add(k); S.history.push(h); added++;
      if (!resolveSym(h.sym)) unknown.add(h.sym);
    });
    S.history.sort((a, b) => toTime(b.closed) - toTime(a.closed));
    save(); onDataChange();
    toast("Import selesai", `${added} trade baru ditambahkan, ${rows.length - added} sudah ada.`, "ok");
    if (unknown.size) toast("Simbol belum dikenal", `${[...unknown].slice(0, 5).join(", ")}. Tambahkan di Pengaturan → Simbol agar perhitungan R akurat.`, "warn");
  } catch (err) { console.error(err); toast("Gagal membaca file", "Format file tidak dikenali.", "danger"); }
});
function decodeFile(buf) {
  const b = new Uint8Array(buf);
  if (b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder("utf-16le").decode(buf);
  if (b[0] === 0xFE && b[1] === 0xFF) return new TextDecoder("utf-16be").decode(buf);
  const t = new TextDecoder("utf-8").decode(buf);
  return /\u0000/.test(t.slice(0, 400)) ? new TextDecoder("utf-16le").decode(buf) : t;
}
function parseMtDate(s) {
  const m = String(s).match(/(\d{4})[.\-/](\d{2})[.\-/](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).toISOString() : null;
}
function parseMt5Html(html) {
  const doc = new DOMParser().parseFromString(html, "text/html"), out = [];
  for (const tr of doc.querySelectorAll("tr")) {
    const t = [...tr.children].filter(td => !td.classList.contains("hidden")).map(c => c.textContent.replace(/\u00a0/g, " ").trim());
    // Tabel Positions: Time, Position, Symbol, Type, Volume, Price, S/L, T/P, Time, Price, Commission, Swap, Profit
    if (t.length < 13 || !/^(buy|sell)/i.test(t[3]) || !parseMtDate(t[0]) || !parseMtDate(t[8]) || !isFinite(num(t[9])) || !isFinite(num(t[12]))) continue;
    const dirv = /^sell/i.test(t[3]) ? "sell" : "buy";
    const lot = num(String(t[4]).split("/")[0]), entry = num(t[5]), sl = num(t[6]), tp = num(t[7]), exit = num(t[9]);
    const pnl = (num(t[12]) || 0) + (num(t[10]) || 0) + (num(t[11]) || 0);
    const symObj = resolveSym(t[2]);
    const symName = symObj ? symObj.s : t[2].toUpperCase();
    let risk = NaN;
    if (symObj && sl > 0) { const r = calc({ sym: symName, dir: dirv, lot, entry, sl, tp: NaN, nights: 0 }); if (r && r.slOk) risk = Math.abs(r.grossLoss); }
    const near = (a, b) => symObj && a > 0 && Math.abs(a - b) <= symObj.pip * 3;
    out.push({ id: uid(), ticket: t[1], sym: symName, dir: dirv, lot, entry, sl: sl > 0 ? sl : NaN, tp: tp > 0 ? tp : NaN, exit, pnl, risk,
      result: near(tp, exit) ? "TP" : near(sl, exit) ? "SL" : "Manual", opened: parseMtDate(t[0]), closed: parseMtDate(t[8]), setup: "", emo: "", note: "", src: "mt5" });
  }
  return out;
}
function parseCsv(text) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === "," || c === ";") { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else if (c !== "\r") cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
function parseCsvJournal(text) {
  const rows = parseCsv(text.replace(/^\ufeff/, ""));
  if (rows.length < 2) return [];
  const head = rows[0].map(h => h.trim().toLowerCase()), ix = k => head.indexOf(k);
  if (ix("symbol") < 0 || ix("pnl") < 0) return [];
  return rows.slice(1).filter(r => r.length >= head.length - 1 && r[ix("symbol")]).map(r => {
    const g = k => ix(k) >= 0 ? r[ix(k)] : "";
    return { id: uid(), ticket: g("ticket"), sym: g("symbol"), dir: /sell/i.test(g("direction")) ? "sell" : "buy", lot: num(g("lot")),
      entry: num(g("entry")), sl: num(g("sl")), tp: num(g("tp")), exit: num(g("exit")), pnl: num(g("pnl")) || 0, risk: num(g("risk")),
      result: g("result") || "Manual", opened: g("opened") || g("closed"), closed: g("closed") || new Date().toISOString(),
      setup: g("setup"), emo: g("emotion"), note: g("note"), src: g("source") || "csv" };
  });
}

/* ================================================================
 * 10. ANALITIK
 * ================================================================ */
function sessionOf(iso) {
  const h = new Date(iso).getUTCHours();
  return h < 7 ? "Asia" : h < 12 ? "London" : h < 16 ? "London + New York" : h < 21 ? "New York" : "Sydney";
}
function computeStats(L) {
  const s = { n: L.length };
  const wins = L.filter(h => h.pnl > 0), losses = L.filter(h => h.pnl < 0);
  s.gw = wins.reduce((a, h) => a + h.pnl, 0); s.gl = Math.abs(losses.reduce((a, h) => a + h.pnl, 0));
  s.net = s.gw - s.gl; s.wr = L.length ? wins.length / L.length * 100 : NaN;
  s.pf = s.gl ? s.gw / s.gl : (s.gw ? Infinity : NaN);
  s.avgW = wins.length ? s.gw / wins.length : NaN; s.avgL = losses.length ? s.gl / losses.length : NaN;
  s.exp = L.length ? s.net / L.length : NaN;
  const Rs = L.map(rMult).filter(isFinite); s.avgR = Rs.length ? Rs.reduce((a, b) => a + b, 0) / Rs.length : NaN;
  const ord = [...L].sort((a, b) => toTime(a.closed) - toTime(b.closed));
  let eq = 0, peak = 0, dd = 0, ls = 0, ws = 0, mls = 0, mws = 0; s.curve = [0];
  ord.forEach(h => {
    eq += h.pnl; s.curve.push(eq); peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq);
    if (h.pnl < 0) { ls++; ws = 0; } else if (h.pnl > 0) { ws++; ls = 0; }
    mls = Math.max(mls, ls); mws = Math.max(mws, ws);
  });
  s.maxDD = dd; s.mls = mls; s.mws = mws;
  const startBal = S.settings.autoBal ? S.settings.balance - realizedSince(0) : S.settings.balance;
  s.maxDDpct = startBal > 0 ? dd / (startBal + Math.max(0, peak)) * 100 : NaN;
  s.best = L.length ? Math.max(...L.map(h => h.pnl)) : NaN; s.worst = L.length ? Math.min(...L.map(h => h.pnl)) : NaN;
  return s;
}
function groupBy(L, keyFn, order) {
  const m = {};
  L.forEach(h => { const k = keyFn(h); if (!k) return; (m[k] = m[k] || []).push(h); });
  let rows = Object.entries(m).map(([k, list]) => ({ k, n: list.length, wr: list.filter(h => h.pnl > 0).length / list.length * 100, net: list.reduce((a, h) => a + h.pnl, 0) }));
  if (order) rows.sort((a, b) => order.indexOf(a.k) - order.indexOf(b.k)); else rows.sort((a, b) => b.net - a.net);
  return rows;
}
function barList(el, rows, emptyMsg) {
  if (!rows.length) { $(el).innerHTML = `<p class="empty">${emptyMsg || "Belum ada data."}</p>`; return; }
  const mx = Math.max(...rows.map(r => Math.abs(r.net))) || 1;
  $(el).innerHTML = rows.map(r => `<div class="brow"><div class="bk">${esc(r.k)}<span>${r.n} trade · WR ${fmt(r.wr, 0)}%</span></div>
    <div class="btrack"><i class="${r.net >= 0 ? "pos" : "neg"}" style="width:${Math.abs(r.net) / mx * 50}%"></i></div>
    <div class="bv num ${r.net >= 0 ? "c-buy" : "c-sell"}">${moneyS(r.net)}</div></div>`).join("");
}
function lineChart(svg, series, opts = {}) {
  const W = 600, H = 160, pad = 8;
  const all = series.flatMap(s => s.pts).concat(opts.band ? opts.band.flat() : []);
  if (all.length < 2) { $(svg).innerHTML = `<text x="300" y="84" text-anchor="middle" fill="currentColor" opacity=".55" font-size="13" font-family="Manrope,sans-serif">${esc(opts.empty || "Belum ada data")}</text>`; return; }
  const mn = Math.min(...all, opts.base ?? Infinity), mx = Math.max(...all, opts.base ?? -Infinity), rg = (mx - mn) || 1;
  const n = series[0].pts.length;
  const X = i => i / (n - 1) * W, Y = v => H - pad - (v - mn) / rg * (H - pad * 2);
  let out = "";
  if (opts.base != null) out += `<line x1="0" x2="${W}" y1="${Y(opts.base)}" y2="${Y(opts.base)}" stroke="currentColor" opacity=".25" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>`;
  if (opts.band) {
    const [lo, hi] = opts.band;
    out += `<path d="M${hi.map((v, i) => X(i).toFixed(1) + "," + Y(v).toFixed(1)).join("L")}L${lo.map((v, i) => [i, v]).reverse().map(([i, v]) => X(i).toFixed(1) + "," + Y(v).toFixed(1)).join("L")}Z" fill="${opts.bandColor}" opacity=".16"/>`;
  }
  series.forEach(s => {
    const d = s.pts.map((v, i) => (i ? "L" : "M") + X(i).toFixed(1) + "," + Y(v).toFixed(1)).join("");
    if (s.fill) out += `<path d="${d}L${W},${H}L0,${H}Z" fill="${s.color}" opacity=".12"/>`;
    out += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.w || 2}" opacity="${s.op || 1}" vector-effect="non-scaling-stroke"/>`;
  });
  $(svg).innerHTML = out;
}
function renderStats() {
  const L = periodFilter(S.history, $("sPeriod").value), s = computeStats(L);
  const k = (label, val, cls = "") => `<div class="kpi"><span>${label}</span><b class="num ${cls}">${val}</b></div>`;
  $("kpis").innerHTML = [
    k("Total trade", s.n), k("Win rate", pct(s.wr, 1)), k("Net P/L", moneyS(s.net), s.net > 0 ? "c-buy" : s.net < 0 ? "c-sell" : ""),
    k("Profit factor", isFinite(s.pf) ? fmt(s.pf, 2) : s.pf === Infinity ? "∞" : "—"), k("Ekspektasi / trade", moneyS(s.exp)),
    k("Rata-rata R", isFinite(s.avgR) ? fmt(s.avgR, 2) + "R" : "—"), k("Rata-rata profit", money(s.avgW), "c-buy"), k("Rata-rata rugi", money(isFinite(s.avgL) ? -s.avgL : NaN), "c-sell"),
    k("Drawdown maks", s.n ? `${money(-s.maxDD)}${isFinite(s.maxDDpct) ? " · " + pct(s.maxDDpct, 1) : ""}` : "—", "c-sell"),
    k("Rugi beruntun maks", s.n ? s.mls + "×" : "—"), k("Profit terbesar", moneyS(s.best)), k("Rugi terbesar", moneyS(s.worst))
  ].join("");
  const col = s.net >= 0 ? getCss("--buy") : getCss("--sell");
  lineChart("curve", [{ pts: s.curve, color: col, fill: true }], { base: 0, empty: "Kurva ekuitas muncul setelah trade pertama ditutup" });

  barList("byPair", groupBy(L, h => h.sym).slice(0, 10));
  barList("bySess", groupBy(L, h => sessionOf(h.opened || h.closed), ["Sydney", "Asia", "London", "London + New York", "New York"]));
  barList("byDay", groupBy(L, h => DAYS[new Date(h.opened || h.closed).getDay()], DAYS));
  barList("bySetup", groupBy(L, h => h.setup), "Pilih setup saat entry agar data ini terisi.");
  barList("byEmo", groupBy(L, h => h.emo), "Pilih kondisi emosi saat entry agar data ini terisi.");

  const ins = [];
  if (s.n < 5) ins.push("Kumpulkan minimal 20–30 trade agar pola mulai terlihat bermakna.");
  else {
    const pairs = groupBy(L, h => h.sym).filter(r => r.n >= 2);
    if (pairs.length) { const b = pairs[0], w = pairs[pairs.length - 1];
      ins.push(`Pair terbaik: <b>${esc(b.k)}</b> (${moneyS(b.net)}, WR ${fmt(b.wr, 0)}%).`);
      if (w.net < 0 && w.k !== b.k) ins.push(`Pair paling merugikan: <b>${esc(w.k)}</b> (${moneyS(w.net)}). Pertimbangkan berhenti trading pair ini sementara.`); }
    const ses = groupBy(L, h => sessionOf(h.opened || h.closed)).filter(r => r.n >= 3);
    if (ses.length > 1) { const w = ses[ses.length - 1]; if (w.net < 0) ins.push(`Sesi ${esc(w.k)} cenderung merugi (${moneyS(w.net)} dari ${w.n} trade).`); }
    const emo = groupBy(L, h => h.emo).filter(r => r.n >= 2);
    const badEmo = emo.filter(r => r.net < 0).pop();
    if (badEmo) ins.push(`Saat merasa <b>${esc(badEmo.k)}</b>, hasil Anda ${moneyS(badEmo.net)}. Jadikan ini sinyal untuk tidak entry.`);
    if (isFinite(s.avgW) && isFinite(s.avgL)) {
      const rr = s.avgW / s.avgL, be = 100 / (1 + rr);
      ins.push(`Rata-rata profit ${fmt(rr, 2)}× rata-rata rugi, jadi Anda butuh win rate di atas ${fmt(be, 0)}% untuk untung. Saat ini ${fmt(s.wr, 0)}%.`);
    }
    if (s.mls >= 4) ins.push(`Pernah rugi ${s.mls}× berturut-turut. Pastikan risiko per trade cukup kecil untuk bertahan dari rangkaian seperti ini.`);
  }
  $("insights").innerHTML = ins.map(t => `<li>${t}</li>`).join("");
}
$("sPeriod").addEventListener("change", renderStats);
const getCss = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || "#888";

/* ================================================================
 * 11. ALAT: PARTIAL CLOSE & SIMULASI
 * ================================================================ */
let pcLastEdit = "r";
$("pcR").addEventListener("input", () => { pcLastEdit = "r"; renderPartial(); });
$("pcTp1").addEventListener("input", () => { pcLastEdit = "price"; renderPartial(); });
["pcPct", "pcPlus"].forEach(id => $(id).addEventListener("input", renderPartial));
$("pcMove").addEventListener("change", renderPartial);

function renderPartial() {
  const p = readForm(), r = calc(p), sym = resolveSym(curSym), st = S.settings;
  $("pcPlus").disabled = $("pcMove").value !== "bep";
  if (!r || !r.slOk || !r.tpOk) {
    $("pcInfo").innerHTML = `Isi entry, SL, dan TP di <a href="#dash" data-go="dash">Dashboard</a> terlebih dahulu. Alat ini memakai rencana entry tersebut.`;
    $("pcOut").innerHTML = ""; return;
  }
  const sign = dir === "buy" ? 1 : -1;
  $("pcInfo").innerHTML = `Rencana: <b class="num">${esc(curSym)} ${dir.toUpperCase()} ${p.lot} lot</b> · entry <span class="num">${fmtP(p.entry, sym.d)}</span> · SL <span class="num">${fmtP(p.sl, sym.d)}</span> · TP <span class="num">${fmtP(p.tp, sym.d)}</span>`;
  let tp1;
  if (pcLastEdit === "r") { const R = num($("pcR").value); tp1 = p.entry + sign * R * r.slDist; if (isFinite(tp1)) $("pcTp1").value = tp1.toFixed(sym.d); }
  else { tp1 = num($("pcTp1").value); if (isFinite(tp1)) $("pcR").value = +(((tp1 - p.entry) * sign) / r.slDist).toFixed(2); }
  const errs = [];
  if (!isFinite(tp1) || (tp1 - p.entry) * sign <= 0) errs.push("Target 1 harus berada di arah profit.");
  else if ((tp1 - p.tp) * sign >= 0) errs.push("Target 1 harus lebih dekat dari TP akhir.");
  const step = st.lotStep || 0.01, pctC = clamp(num($("pcPct").value) || 0, 0, 100);
  const lot1 = roundLot(p.lot * pctC / 100, step), lot2 = +(p.lot - lot1).toFixed(2);
  if (lot1 < step) errs.push(`Lot yang ditutup (${fmt(p.lot * pctC / 100, 3)}) lebih kecil dari lot minimum ${step}. Perbesar lot atau persentase.`);
  if (lot2 < step) errs.push("Sisa lot terlalu kecil. Kurangi persentase.");
  if (errs.length) { $("pcOut").innerHTML = `<p class="hint err" style="margin-top:6px">${errs.join(" ")}</p>`; return; }

  const mv = $("pcMove").value;
  const newSl = mv === "be" ? p.entry : mv === "bep" ? p.entry + sign * (num($("pcPlus").value) || 0) * sym.pip : p.sl;
  const P = (lot, exit) => pnlAt(sym, dir, lot, p.entry, exit);
  const cost = r.cost, risk = r.risk;
  const sc = [
    ["SL kena sebelum target 1", P(p.lot, p.sl) - cost],
    [`Target 1, lalu sisa kena SL baru`, P(lot1, tp1) + P(lot2, newSl) - cost],
    [`Target 1, lalu sisa kena TP`, P(lot1, tp1) + P(lot2, p.tp) - cost],
    ["Tanpa partial: langsung TP penuh", P(p.lot, p.tp) - cost]
  ];
  $("pcOut").innerHTML = `<table class="scen" style="margin-top:6px"><thead><tr><th>Skenario</th><th style="text-align:right">Hasil</th><th style="text-align:right">R</th></tr></thead><tbody>` +
    sc.map(([n, v]) => `<tr><td>${n}</td><td class="num ${v >= 0 ? "c-buy" : "c-sell"}" style="text-align:right">${moneyS(v)}</td><td class="num" style="text-align:right">${fmt(v / risk, 2)}R</td></tr>`).join("") +
    `</tbody></table><p class="hint" style="margin-top:10px">Tutup <b class="num">${lot1}</b> lot di <span class="num">${fmtP(tp1, sym.d)}</span>, sisakan <b class="num">${lot2}</b> lot dengan SL di <span class="num">${fmtP(newSl, sym.d)}</span>. ` +
    (sc[1][1] >= 0 ? "Setelah target 1 tercapai, posisi ini tidak bisa lagi berakhir rugi." : "Setelah target 1, posisi masih bisa rugi karena SL belum digeser cukup jauh.") + `</p>`;
}

function percentile(sorted, q) { if (!sorted.length) return NaN; const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo); }
$("smFromJ").onclick = () => {
  const s = computeStats(S.history);
  if (s.n < 5 || !isFinite(s.avgW) || !isFinite(s.avgL)) { toast("Data jurnal belum cukup", "Butuh minimal 5 trade dengan profit dan rugi."); return; }
  $("smWr").value = +s.wr.toFixed(1);
  $("smRr").value = +(s.avgW / s.avgL).toFixed(2);
  $("smBal").value = S.settings.balance;
  toast("Statistik jurnal dipakai", `Win rate ${fmt(s.wr, 1)}%, R:R rata-rata ${fmt(s.avgW / s.avgL, 2)}.`, "ok");
};
$("smRun").onclick = () => {
  const bal0 = num($("smBal").value), risk = num($("smRisk").value) / 100, wr = num($("smWr").value) / 100, rr = num($("smRr").value);
  const n = Math.round(num($("smN").value)), ddLim = num($("smDD").value) / 100, comp = $("smComp").checked, runs = 1000;
  if (!(bal0 > 0) || !(risk > 0) || !(wr >= 0 && wr <= 1) || !(rr > 0) || !(n >= 1 && n <= 2000) || !(ddLim > 0)) {
    toast("Isian belum lengkap", "Periksa modal, risiko, win rate (0–100), R:R, dan jumlah trade (1–2000).", "danger"); return;
  }
  const steps = Array.from({ length: n + 1 }, () => new Float64Array(runs));
  const finals = [], dds = [], streaks = []; let hitDD = 0;
  for (let k = 0; k < runs; k++) {
    let eq = bal0, peak = bal0, maxdd = 0, ls = 0, mls = 0, hit = false;
    steps[0][k] = eq;
    for (let i = 0; i < n; i++) {
      const stake = (comp ? eq : bal0) * risk;
      if (Math.random() < wr) { eq += stake * rr; ls = 0; } else { eq -= stake; ls++; if (ls > mls) mls = ls; }
      if (eq < 0) eq = 0;
      if (eq > peak) peak = eq;
      const dd = peak > 0 ? (peak - eq) / peak : 1;
      if (dd > maxdd) maxdd = dd;
      if (dd >= ddLim) hit = true;
      steps[i + 1][k] = eq;
    }
    finals.push(eq); dds.push(maxdd); streaks.push(mls); if (hit) hitDD++;
  }
  const sortN = a => [...a].sort((x, y) => x - y);
  const fS = sortN(finals), dS = sortN(dds), sS = sortN(streaks);
  const p5 = [], p50 = [], p95 = [];
  steps.forEach(arr => { const s = Float64Array.from(arr).sort(); p5.push(percentile(s, .05)); p50.push(percentile(s, .5)); p95.push(percentile(s, .95)); });
  const brass = getCss("--brass");
  lineChart("smChart", [{ pts: p50, color: brass, w: 2.5 }, { pts: p5, color: getCss("--sell"), w: 1, op: .7 }, { pts: p95, color: getCss("--buy"), w: 1, op: .7 }],
    { band: [p5, p95], bandColor: brass, base: bal0 });
  const ev = wr * rr - (1 - wr);
  const k = (label, val, cls = "") => `<div class="kpi"><span>${label}</span><b class="num ${cls}">${val}</b></div>`;
  const prof = finals.filter(v => v > bal0).length / runs * 100;
  $("smOut").innerHTML = [
    k("Hasil median", money(percentile(fS, .5))), k("Skenario buruk (5%)", money(percentile(fS, .05)), "c-sell"), k("Skenario baik (95%)", money(percentile(fS, .95)), "c-buy"),
    k("Peluang berakhir profit", pct(prof, 0)), k("Median drawdown maks", pct(percentile(dS, .5) * 100, 1)),
    k(`Peluang drawdown ≥ ${fmt(ddLim * 100, 0)}%`, pct(hitDD / runs * 100, 0), hitDD / runs > .2 ? "c-sell" : ""),
    k("Rugi beruntun terpanjang (median)", Math.round(percentile(sS, .5)) + "×"), k("Ekspektasi per trade", (ev >= 0 ? "+" : "") + fmt(ev, 2) + "R", ev >= 0 ? "c-buy" : "c-sell")
  ].join("");
  if (ev < 0) toast("Sistem dengan ekspektasi negatif", "Dengan win rate dan R:R ini, modal cenderung berkurang dalam jangka panjang.", "warn");
};

/* ================================================================
 * 12. KALENDER BERITA
 * ================================================================ */
const NEWS_CCY = ["USD","EUR","GBP","JPY","AUD","NZD","CAD","CHF","CNY","CNH"];
function renderNews() {
  const cutoff = Date.now() - 2 * 864e5;
  const before = S.news.length;
  S.news = S.news.filter(n => n.t >= cutoff);
  if (S.news.length !== before) save();
  const list = [...S.news].sort((a, b) => a.t - b.t);
  if (!list.length) { $("newsList").innerHTML = `<p class="empty">Belum ada jadwal. Ambil kalender otomatis atau tambahkan manual di samping.</p>`; return; }
  let html = "", lastDay = "";
  list.forEach(n => {
    const day = new Date(n.t).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long" });
    if (day !== lastDay) { html += `<h3 style="margin:16px 0 4px">${day}</h3>`; lastDay = day; }
    html += newsRow(n, true);
  });
  $("newsList").innerHTML = html;
}
$("newsList").addEventListener("click", e => {
  const b = e.target.closest("[data-ndel]"); if (!b) return;
  S.news = S.news.filter(n => n.id !== b.dataset.ndel); save(); renderNews(); renderNewsSoon(); update();
});
$("nAdd").onclick = () => {
  const t = new Date($("nTime").value).getTime(), title = $("nTitle").value.trim();
  if (!isFinite(t)) { toast("Waktu belum diisi", "Pilih tanggal dan jam rilis berita.", "danger"); return; }
  if (!title) { toast("Nama berita belum diisi", "Contoh: CPI, NFP, FOMC.", "danger"); return; }
  S.news.push({ id: uid(), t, ccy: $("nCcy").value, title, imp: $("nImp").value });
  save(); $("nTitle").value = "";
  renderNews(); renderNewsSoon(); update();
  toast("Berita ditambahkan", `${$("nCcy").value} · ${title}`, "ok");
};
$("nFetch").onclick = async () => {
  const btn = $("nFetch"); btn.disabled = true; $("nInfo").textContent = "Mengambil kalender…";
  try {
    const res = await fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.json", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const arr = await res.json();
    const keys = new Set(S.news.map(n => n.t + n.ccy + n.title));
    let added = 0;
    arr.forEach(x => {
      const imp = x.impact === "High" ? "high" : x.impact === "Medium" ? "med" : null;
      const t = new Date(x.date).getTime();
      if (!imp || !isFinite(t)) return;
      const k = t + x.country + x.title;
      if (keys.has(k)) return;
      keys.add(k); S.news.push({ id: uid(), t, ccy: x.country, title: x.title, imp, src: "ff" }); added++;
    });
    save(); renderNews(); renderNewsSoon(); update();
    $("nInfo").textContent = `${added} berita baru ditambahkan dari kalender minggu ini.`;
  } catch (e) {
    $("nInfo").innerHTML = `Kalender otomatis tidak bisa diakses dari browser ini. Tambahkan manual dari <a href="https://www.forexfactory.com/calendar" target="_blank" rel="noopener">forexfactory.com/calendar</a>.`;
  }
  btn.disabled = false;
};

/* ================================================================
 * 13. PENGATURAN
 * ================================================================ */
let authed = false;
const ccyOptions = cur => Object.keys(S.rates).map(c => `<option value="${c}" ${c === cur ? "selected" : ""}>${c === "USC" ? "USC (akun cent)" : c}</option>`).join("");

function showSettings() {
  $("pinView").hidden = authed; $("setView").hidden = !authed;
  if (!authed) { $("pinInput").value = ""; $("pinErr").textContent = ""; setTimeout(() => $("pinInput").focus(), 80); }
  else fillSettings();
}
function tryPin() {
  if (hash($("pinInput").value) === S.settings.pin) { authed = true; showSettings(); }
  else { $("pinErr").textContent = "PIN salah. Coba lagi."; $("pinInput").select(); }
}
$("pinBtn").onclick = tryPin;
$("pinInput").addEventListener("keydown", e => { if (e.key === "Enter") tryPin(); });
$("lockSet").onclick = () => { authed = false; showSettings(); };
$("forgotPin").onclick = async () => {
  if (!(await confirmBox("Reset PIN dan pengaturan?", "PIN kembali ke 1234 dan pengaturan akun kembali ke bawaan. Posisi, jurnal, simbol, dan berita tidak dihapus.", "Reset"))) return;
  const keep = { sb: S.settings.sb, theme: S.settings.theme };
  S.settings = { ...blank().settings, ...keep, onboarded: true };
  save(); authed = true; showSettings(); onDataChange();
  toast("PIN direset", "PIN sekarang 1234. Segera ganti di tab Data & keamanan.", "warn");
};
$$(".tabs button").forEach(b => b.onclick = () => {
  $$(".tabs button").forEach(x => x.classList.toggle("on", x === b));
  $$(".tabpane").forEach(p => p.classList.toggle("on", p.id === b.dataset.tab));
});

function fillSettings() {
  const st = S.settings, set = (id, v) => $(id).value = v, chk = (id, v) => $(id).checked = !!v;
  set("aBal", st.balance); $("aCcy").innerHTML = ccyOptions(st.ccy); set("aLev", st.leverage);
  set("aMax", st.maxRisk); set("aWarn", st.warnAt); set("aPer", st.perTrade);
  set("aDay", st.dailyLoss); set("aWeek", st.weeklyLoss); set("aMinRR", st.minRR);
  set("aLotStep", st.lotStep); set("aNewsWin", st.newsWin);
  chk("aBlock", st.block); chk("aLock", st.lossLock); chk("aCorr", st.corrWarn); chk("aNews", st.newsWarn);
  chk("aAutoBal", st.autoBal); chk("aSound", st.sound); chk("aNotif", st.notif);
  set("aSetups", st.setups.join(", ")); set("aEmos", st.emotions.join(", "));
  chk("cCosts", st.costs); set("cComm", st.comm);
  $("rateGrid").innerHTML = Object.entries(S.rates).filter(([c]) => c !== "USD" && c !== "USC").map(([c, v]) =>
    `<div class="field"><label for="r_${c}">1 USD = … ${c}</label><input type="number" class="num" id="r_${c}" data-rate="${c}" step="any" value="${v}"></div>`).join("");
  set("sbUrl", st.sb.url); set("sbKey", st.sb.key);
  const def = defaultSb(), builtIn = !!(def.url && def.key);
  $("sbUrl").placeholder = def.url || "https://xxxx.supabase.co";
  $("sbKey").placeholder = builtIn ? "Memakai key bawaan situs" : "";
  $$("#t-cloud .steps")[0].hidden = builtIn;
  $("sbUrl").closest(".row").hidden = builtIn && !st.sb.url;
  $("saveSb").parentElement.hidden = builtIn && !st.sb.url;
  $("cloudIntro").textContent = builtIn
    ? "Masuk atau daftar dengan email untuk menyinkronkan data di semua perangkat. Setiap orang memakai akunnya sendiri, dan posisi MT5 bisa masuk otomatis."
    : "Opsional. Dengan akun cloud, data tersinkron di semua perangkat Anda, setiap orang punya akun sendiri, dan posisi MT5 bisa masuk otomatis.";
  chk("aLiveMeter", st.liveInMeter); chk("aFollowBal", st.followMt5Bal);
  renderSymAdmin(); Cloud.render();
}
$("saveAcc").onclick = () => {
  const g = id => num($(id).value);
  const vals = { balance: g("aBal"), leverage: g("aLev"), maxRisk: g("aMax"), warnAt: g("aWarn"), perTrade: g("aPer"),
    minRR: g("aMinRR"), lotStep: g("aLotStep"), dailyLoss: g("aDay"), weeklyLoss: g("aWeek"), newsWin: g("aNewsWin") };
  const names = { balance: "Modal", leverage: "Leverage", maxRisk: "Batas total risiko", warnAt: "Peringatan dini", perTrade: "Risiko per trade",
    minRR: "R:R minimum", lotStep: "Langkah lot", dailyLoss: "Batas rugi harian", weeklyLoss: "Batas rugi mingguan", newsWin: "Jeda berita" };
  for (const [k, v] of Object.entries(vals)) {
    const allowZero = ["dailyLoss", "weeklyLoss", "newsWin", "minRR"].includes(k);
    if (!(allowZero ? v >= 0 : v > 0)) { toast("Nilai tidak valid", `${names[k]} harus berupa angka ${allowZero ? "0 atau lebih" : "lebih dari 0"}.`, "danger"); return; }
  }
  const list = id => [...new Set($(id).value.split(",").map(s => s.trim()).filter(Boolean))];
  Object.assign(S.settings, vals, { ccy: $("aCcy").value, block: $("aBlock").checked, lossLock: $("aLock").checked, corrWarn: $("aCorr").checked,
    newsWarn: $("aNews").checked, autoBal: $("aAutoBal").checked, sound: $("aSound").checked, notif: $("aNotif").checked,
    setups: list("aSetups"), emotions: list("aEmos") });
  if (S.settings.notif && "Notification" in window && Notification.permission === "default") Notification.requestPermission();
  save(); lastLevel = null; renderTagInputs(); onDataChange();
  toast("Pengaturan disimpan", "Semua perhitungan memakai nilai baru.", "ok");
};
$("saveCost").onclick = () => {
  const c = num($("cComm").value);
  if (!(c >= 0)) { toast("Komisi tidak valid", "Isi 0 jika akun Anda tanpa komisi.", "danger"); return; }
  S.settings.costs = $("cCosts").checked; S.settings.comm = c; save(); onDataChange();
  toast("Biaya disimpan", S.settings.costs ? "Spread, komisi, dan swap ikut dihitung." : "Biaya tidak dihitung.", "ok");
};
$("saveRates").onclick = () => {
  $$("[data-rate]").forEach(i => { const v = num(i.value); if (v > 0) S.rates[i.dataset.rate] = v; });
  save(); onDataChange(); toast("Kurs disimpan", "Konversi hasil diperbarui.", "ok");
};
$("fetchRates").onclick = async () => {
  $("rateInfo").textContent = "Mengambil kurs…";
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    const j = await res.json();
    if (j.result !== "success") throw new Error();
    let n = 0;
    Object.keys(S.rates).forEach(c => { if (c === "USD" || c === "USC") return; const k = c === "CNH" ? "CNY" : c; if (j.rates[k]) { S.rates[c] = +j.rates[k].toFixed(4); n++; } });
    save(); fillSettings(); onDataChange();
    $("rateInfo").textContent = `${n} kurs diperbarui (${new Date(j.time_last_update_unix * 1000).toLocaleDateString("id-ID")}).`;
  } catch (e) { $("rateInfo").textContent = "Gagal mengambil kurs. Isi manual dari Market Watch MT5."; }
};

/* ---------- Tabel simbol ---------- */
function renderSymAdmin() {
  const q = $("symFilter").value.toUpperCase().trim(), ccys = Object.keys(S.rates).filter(c => c !== "USC");
  $("symBody").innerHTML = S.symbols.map((x, i) => (q && !x.s.includes(q) && !x.c.toUpperCase().includes(q)) ? "" : `<tr data-i="${i}">
    <td><input type="text" data-k="s" value="${esc(x.s)}" class="num" aria-label="Simbol"></td>
    <td><input type="text" data-k="c" value="${esc(x.c)}" aria-label="Kategori"></td>
    <td><input type="number" data-k="cs" value="${x.cs}" step="any" class="num" aria-label="Contract size"></td>
    <td><input type="number" data-k="pip" value="${x.pip}" step="any" class="num" aria-label="Ukuran pip"></td>
    <td><input type="number" data-k="d" value="${x.d}" step="1" class="num" style="min-width:56px" aria-label="Digit"></td>
    <td><select data-k="q" aria-label="Mata uang kutipan">${ccys.map(c => `<option ${c === x.q ? "selected" : ""}>${c}</option>`).join("")}</select></td>
    <td><input type="number" data-k="spr" value="${x.spr}" step="any" class="num" aria-label="Spread"></td>
    <td><input type="number" data-k="swL" value="${x.swL}" step="any" class="num" aria-label="Swap buy"></td>
    <td><input type="number" data-k="swS" value="${x.swS}" step="any" class="num" aria-label="Swap sell"></td>
    <td><button class="btn sm ghost" data-sdel="${i}" type="button" aria-label="Hapus simbol">✕</button></td></tr>`).join("");
}
$("symFilter").addEventListener("input", renderSymAdmin);
$("symBody").addEventListener("change", e => {
  const tr = e.target.closest("tr"), k = e.target.dataset.k; if (!tr || !k) return;
  const x = S.symbols[+tr.dataset.i];
  x[k] = k === "s" ? e.target.value.toUpperCase().trim() : (k === "c" || k === "q") ? e.target.value : num(e.target.value);
  resolveCache.clear();
});
$("symBody").addEventListener("click", async e => {
  const b = e.target.closest("[data-sdel]"); if (!b || S.symbols.length <= 1) return;
  const x = S.symbols[+b.dataset.sdel];
  if (!(await confirmBox(`Hapus simbol ${x.s}?`, "Simbol akan hilang dari daftar pilihan.", "Hapus"))) return;
  S.symbols.splice(+b.dataset.sdel, 1); save(); renderSymAdmin(); pickSym(curSym);
});
$("addSym").onclick = () => { S.symbols.unshift({ s: "SIMBOLBARU", c: "Lainnya", cs: 1, pip: 0.01, d: 2, q: "USD", spr: 0, swL: 0, swS: 0 }); $("symFilter").value = ""; renderSymAdmin(); $("symBody").querySelector("input").select(); };
$("saveSyms").onclick = () => {
  const bad = S.symbols.find(x => !x.s || !(x.cs > 0) || !(x.pip > 0) || !(x.d >= 0) || !(x.spr >= 0) || !isFinite(x.swL) || !isFinite(x.swS));
  if (bad) { toast("Data simbol belum lengkap", `Periksa ${bad.s || "(tanpa nama)"}: contract, pip, digit, dan spread harus angka yang valid.`, "danger"); return; }
  const dup = S.symbols.map(x => x.s).find((s, i, a) => a.indexOf(s) !== i);
  if (dup) { toast("Simbol ganda", `${dup} muncul lebih dari sekali.`, "danger"); return; }
  save(); pickSym(curSym); onDataChange(); toast("Simbol disimpan", `${S.symbols.length} simbol tersedia.`, "ok");
};
$("resetSyms").onclick = async () => {
  if (!(await confirmBox("Kembalikan daftar simbol bawaan?", "Semua perubahan contract size, spread, swap, dan simbol tambahan akan hilang.", "Kembalikan"))) return;
  S.symbols = DEFAULT_SYMBOLS.map(x => ({ ...x })); save(); renderSymAdmin(); pickSym(curSym); onDataChange();
};

/* ---------- Keamanan & data ---------- */
$("savePin").onclick = () => {
  const v = $("newPin").value;
  if (!/^\d{4,8}$/.test(v)) { toast("PIN tidak valid", "Gunakan 4–8 angka.", "danger"); return; }
  S.settings.pin = hash(v); save(); $("newPin").value = ""; toast("PIN diganti", "Gunakan PIN baru saat membuka pengaturan.", "ok");
};
$("backup").onclick = () => download(`riskdesk-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ app: "RiskDesk", version: VERSION, ...exportData() }, null, 2), "application/json");
$("restore").addEventListener("change", e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  const rd = new FileReader();
  rd.onload = async () => {
    try {
      const d = JSON.parse(rd.result);
      if (!d.settings || !Array.isArray(d.symbols)) throw new Error();
      if (!(await confirmBox("Pulihkan backup?", "Data di perangkat ini akan diganti dengan isi file backup.", "Pulihkan", false))) return;
      applyData(d);
      toast("Backup dipulihkan", "Semua data telah dimuat ulang.", "ok");
    } catch (err) { toast("File tidak dikenali", "Pilih file backup JSON dari RiskDesk.", "danger"); }
  };
  rd.readAsText(f);
});
$("resetAll").onclick = async () => {
  if (!(await confirmBox("Reset semua data?", "Pengaturan, simbol, posisi, jurnal, dan berita di perangkat ini akan dihapus. Data di cloud tidak ikut terhapus.", "Reset semua"))) return;
  Cloud.signOut(true); lsDel(KEY); lsDel(OLD_KEY);
  S = blank(); authed = false; save({ noSync: true });
  refreshAll(); go("dash"); openOnboarding();
};
function applyData(d, t) {
  S = normalize(d);
  if (t) S.updatedAt = t;
  lsSet(KEY, JSON.stringify(S)); resolveCache.clear();
  refreshAll();
}
function refreshAll() {
  applyTheme(); renderTagInputs(); pickSym(resolveSym(S.last.sym) ? resolveSym(S.last.sym).s : "XAUUSD");
  lastLevel = null; onDataChange();
  if (curView === "settings") showSettings();
}

/* ================================================================
 * 14. CLOUD (SUPABASE) & JEMBATAN MT5
 * ================================================================ */
const Cloud = {
  sess: (() => { try { return JSON.parse(lsGet(AUTH_KEY)); } catch (e) { return null; } })(),
  timer: null, status: "local", lastSync: 0, token: "",
  cfg() {
    const sb = S.settings.sb || {}, def = defaultSb();
    const url = sb.url || def.url, key = sb.key || def.key;
    return url && key ? { url: cleanSbUrl(url), key: key.trim() } : null;
  },
  setSess(s) { this.sess = s; s ? lsSet(AUTH_KEY, JSON.stringify(s)) : lsDel(AUTH_KEY); },
  mkSess(j) { return { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000, user: { id: j.user.id, email: j.user.email } }; },
  async req(path, { method = "GET", body, auth = true, prefer } = {}) {
    const c = this.cfg(); if (!c) throw new Error("Koneksi Supabase belum diatur.");
    if (auth) await this.refreshIfNeeded();
    const h = { apikey: c.key, "Content-Type": "application/json" };
    if (auth && this.sess) h.Authorization = "Bearer " + this.sess.access_token;
    if (prefer) h.Prefer = prefer;
    const res = await fetch(c.url + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
    const txt = await res.text(); let j = null; try { j = txt ? JSON.parse(txt) : null; } catch (e) {}
    if (!res.ok) { const err = new Error((j && (j.error_description || j.msg || j.message || j.error)) || "HTTP " + res.status); err.status = res.status; throw err; }
    return j;
  },
  async refreshIfNeeded() {
    const s = this.sess; if (!s || Date.now() < s.expires_at - 60000) return;
    const c = this.cfg();
    const res = await fetch(c.url + "/auth/v1/token?grant_type=refresh_token", { method: "POST", headers: { apikey: c.key, "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: s.refresh_token }) });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j || !j.access_token) { this.signOut(true); toast("Sesi cloud berakhir", "Silakan masuk lagi di Pengaturan → Cloud & MT5.", "warn"); throw new Error("Sesi berakhir"); }
    this.setSess(this.mkSess(j));
  },
  async signIn(email, pw) {
    const j = await this.req("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password: pw }, auth: false });
    this.setSess(this.mkSess(j)); await this.afterLogin(true);
  },
  async signUp(email, pw, invite) {
    const j = await this.req("/auth/v1/signup", { method: "POST", body: { email, password: pw, data: { invite_code: invite || "" } }, auth: false });
    if (j && j.access_token) { this.setSess(this.mkSess(j)); await this.afterLogin(true); return true; }
    return false;
  },
  signOut(silent) { this.setSess(null); this.token = ""; this.status = "local"; Live.reset(); this.chip(); this.render(); if (!silent) toast("Keluar dari akun cloud", "Data tetap tersimpan di perangkat ini.", "ok"); },
  /** Menyamakan data lokal dan cloud. interactive=true: tanya pengguna bila cloud lebih baru. */
  async afterLogin(interactive) {
    const rows = await this.req(`/rest/v1/riskdesk_data?select=data,updated_at&user_id=eq.${this.sess.user.id}`);
    const remote = rows && rows[0], rt = remote ? new Date(remote.updated_at).getTime() : 0;
    if (remote && rt > (S.updatedAt || 0) + 1000) {
      let use = true;
      if (interactive && S.updatedAt) use = await confirmBox("Data cloud ditemukan", `Data cloud terakhir diperbarui ${new Date(rt).toLocaleString("id-ID")}. Muat data cloud ke perangkat ini? Pilih Batal untuk menimpa cloud dengan data perangkat ini.`, "Muat data cloud", false);
      if (use) { const keepSb = S.settings.sb; applyData(remote.data, rt); S.settings.sb = keepSb; lsSet(KEY, JSON.stringify(S)); toast("Data dimuat dari cloud", "Perangkat ini sekarang sama dengan cloud.", "ok"); }
      else await this.push();
    } else if (!remote || (S.updatedAt || 0) > rt + 1000) await this.push();
    this.status = "ok"; this.lastSync = Date.now(); this.chip();
    await this.ensureToken().catch(e => console.warn(e));
    this.render(); Live.start();
  },
  schedule() { if (!this.sess || !this.cfg()) return; clearTimeout(this.timer); this.timer = setTimeout(() => this.push().catch(e => this.fail(e)), 1500); },
  async push() {
    if (!this.sess) return;
    this.status = "syncing"; this.chip();
    await this.req("/rest/v1/riskdesk_data", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
      body: { user_id: this.sess.user.id, data: exportData(), updated_at: new Date(S.updatedAt || Date.now()).toISOString() } });
    this.status = "ok"; this.lastSync = Date.now(); this.chip(); this.render();
  },
  fail(e) { this.status = "error"; this.chip(); console.warn("Sinkronisasi:", e.message); },
  async ensureToken() {
    const id = this.sess.user.id;
    const rows = await this.req(`/rest/v1/riskdesk_mt5?select=token&user_id=eq.${id}`);
    if (rows && rows[0]) this.token = rows[0].token;
    else { const t = randHex(20); await this.req("/rest/v1/riskdesk_mt5", { method: "POST", prefer: "return=minimal", body: { user_id: id, token: t } }); this.token = t; }
  },
  async newToken() {
    const t = randHex(20);
    await this.req(`/rest/v1/riskdesk_mt5?user_id=eq.${this.sess.user.id}`, { method: "PATCH", prefer: "return=minimal", body: { token: t } });
    this.token = t; this.render();
  },
  chip() {
    const c = $("syncChip"), map = { local: ["", "Lokal"], syncing: ["warn", "Menyinkronkan"], ok: ["ok", "Tersinkron"], error: ["err", "Gagal sinkron"] };
    const [cls, txt] = this.sess ? map[this.status] : map.local;
    c.className = "chip " + cls; c.innerHTML = `<i></i>${txt}`;
    $("navCloud").textContent = this.sess ? " dan cloud" : "";
  },
  render() {
    const inn = !!this.sess;
    $("cloudAuth").hidden = inn; $("cloudUser").hidden = !inn;
    if (inn) {
      $("cUserEmail").textContent = this.sess.user.email;
      $("cLastSync").textContent = this.lastSync ? `Sinkron terakhir ${relTime(this.lastSync)}.` : "";
      $("cToken").textContent = this.token || "Memuat…";
    }
    renderLive();
  }
};
$("syncChip").onclick = () => { go("settings"); if (authed) $$(".tabs button").find(b => b.dataset.tab === "t-cloud").click(); };
/** Koneksi bawaan dari config.js (jika pemilik situs sudah mengisinya). */
function defaultSb() {
  const c = window.RISKDESK_CONFIG || {};
  const key = String(c.supabaseKey || "").trim();
  return { url: String(c.supabaseUrl || "").trim(), key: /^sb_secret_/i.test(key) ? "" : key };
}
/** Rapikan Project URL: buang /rest/v1 dan sejenisnya, ubah alamat dashboard menjadi https://REF.supabase.co */
function cleanSbUrl(raw) {
  let u = String(raw || "").trim().replace(/\s+/g, "");
  const dash = u.match(/supabase\.com\/dashboard\/project\/([a-z0-9]+)/i);
  if (dash) return `https://${dash[1].toLowerCase()}.supabase.co`;
  if (u && !/^https?:\/\//i.test(u)) u = "https://" + u;
  const m = u.match(/^(https?:\/\/[^\/?#]+)/i);
  return m ? m[1].replace(/^http:/i, "https:") : u;
}
$("saveSb").onclick = () => {
  const url = $("sbUrl").value.trim() ? cleanSbUrl($("sbUrl").value) : "", key = $("sbKey").value.trim();
  if (url && !/^https:\/\/[^\/]+\.[a-z]{2,}$/i.test(url)) { toast("URL tidak valid", "Contoh yang benar: https://abcdefgh.supabase.co", "danger"); return; }
  if (key && /^sb_secret_/i.test(key)) { toast("Itu secret key", "Jangan pakai secret key. Salin publishable / anon key.", "danger"); return; }
  $("sbUrl").value = url;
  S.settings.sb = { url, key }; save({ noSync: true });
  $("cloudMsg").textContent = url && key ? "Koneksi disimpan. Silakan masuk atau daftar." : "Koneksi dihapus.";
};
async function cloudAuth(mode) {
  const email = $("cEmail").value.trim(), pw = $("cPass").value;
  if (!Cloud.cfg()) { $("cloudMsg").textContent = "Isi dan simpan Project URL serta anon key terlebih dahulu."; return; }
  if (!/^\S+@\S+\.\S+$/.test(email) || pw.length < 6) { $("cloudMsg").textContent = "Isi email yang valid dan kata sandi minimal 6 karakter."; return; }
  $("cloudMsg").textContent = mode === "in" ? "Masuk…" : "Mendaftarkan…";
  try {
    if (mode === "in") { await Cloud.signIn(email, pw); $("cloudMsg").textContent = "Berhasil masuk. Data tersinkron."; }
    else {
      const ok = await Cloud.signUp(email, pw, $("cInvite").value.trim());
      $("cloudMsg").textContent = ok ? "Akun dibuat dan sudah masuk." : "Akun dibuat. Buka email Anda untuk konfirmasi, lalu tekan Masuk.";
    }
    $("cPass").value = "";
  } catch (e) {
    const m = e.message || "";
    $("cloudMsg").textContent = mode === "up" && (/RISKDESK_INVITE_INVALID|database error saving new user/i.test(m) || e.status === 500) ? "Kode undangan salah. Minta kode yang benar ke pemilik situs."
      : /already registered|already exists/i.test(m) ? "Email ini sudah terdaftar. Klik Masuk."
      : /invalid login/i.test(m) ? "Email atau kata sandi salah." : /not confirmed/i.test(m) ? "Email belum dikonfirmasi. Cek kotak masuk Anda."
      : /relation|does not exist|schema cache/i.test(m) ? "Tabel belum dibuat. Jalankan supabase-setup.sql di SQL Editor."
      : /invalid path/i.test(m) ? "Project URL salah. Isi persis seperti https://abcdefgh.supabase.co tanpa tambahan apa pun, lalu Simpan koneksi."
      : /api key|apikey|jwt/i.test(m) ? "Key tidak cocok. Salin ulang publishable / anon key dari Project Settings → API Keys."
      : /failed to fetch|networkerror/i.test(m) ? "Tidak bisa terhubung ke Supabase. Periksa Project URL dan koneksi internet." : "Gagal: " + m;
  }
}
$("cLogin").onclick = () => cloudAuth("in");
$("cSignup").onclick = () => cloudAuth("up");
$("cLogout").onclick = () => Cloud.signOut();
$("cSyncNow").onclick = async () => { try { await Cloud.afterLogin(true); toast("Tersinkron", "Data perangkat dan cloud sudah sama.", "ok"); } catch (e) { Cloud.fail(e); toast("Gagal sinkron", e.message, "danger"); } };
$("cCopyToken").onclick = async () => { try { await navigator.clipboard.writeText(Cloud.token); toast("Token disalin", "Tempel ke input SyncToken di EA.", "ok"); } catch (e) { toast("Gagal menyalin", "Pilih teks token lalu salin manual."); } };
$("cNewToken").onclick = async () => {
  if (!(await confirmBox("Buat token baru?", "EA yang memakai token lama akan berhenti mengirim data sampai token baru dipasang.", "Buat baru", false))) return;
  try { await Cloud.newToken(); toast("Token baru dibuat", "Perbarui input SyncToken di EA.", "ok"); } catch (e) { toast("Gagal", e.message, "danger"); }
};
$("aLiveMeter").onchange = () => { S.settings.liveInMeter = $("aLiveMeter").checked; save(); onDataChange(); };
$("aFollowBal").onchange = () => { S.settings.followMt5Bal = $("aFollowBal").checked; save(); Live.poll(); };

/* ================================================================
 * 15. ONBOARDING, PWA & INISIALISASI
 * ================================================================ */
function openOnboarding() {
  $("oCcy").innerHTML = ccyOptions(S.settings.ccy);
  $("oBal").value = S.settings.balance; $("oLev").value = S.settings.leverage; $("oMax").value = S.settings.maxRisk; $("oDay").value = S.settings.dailyLoss;
  $("onbModal").classList.add("open"); setTimeout(() => $("oBal").focus(), 80);
}
$("oStart").onclick = () => {
  const bal = num($("oBal").value), lev = num($("oLev").value), mx = num($("oMax").value), dl = num($("oDay").value), pin = $("oPin").value;
  if (!(bal > 0) || !(lev > 0) || !(mx > 0) || !(dl >= 0)) { toast("Periksa isian", "Modal, leverage, dan batas risiko harus berupa angka lebih dari 0.", "danger"); return; }
  if (pin && !/^\d{4,8}$/.test(pin)) { toast("PIN tidak valid", "Gunakan 4–8 angka, atau kosongkan.", "danger"); return; }
  Object.assign(S.settings, { balance: bal, ccy: $("oCcy").value, leverage: lev, maxRisk: mx, dailyLoss: dl, weeklyLoss: dl * 2, onboarded: true });
  if (pin) S.settings.pin = hash(pin);
  save(); $("onbModal").classList.remove("open"); lastLevel = null; onDataChange();
  toast("Siap digunakan", pin ? "Pengaturan disimpan." : "PIN pengaturan: 1234. Ganti kapan saja di Pengaturan.", "ok");
};

let deferredInstall = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredInstall = e; $("installBtn").hidden = false; });
$("installBtn").onclick = async () => { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice.catch(() => {}); deferredInstall = null; $("installBtn").hidden = true; };
window.addEventListener("appinstalled", () => { $("installBtn").hidden = true; toast("Terpasang", "RiskDesk sekarang ada di layar utama Anda.", "ok"); });
if ("serviceWorker" in navigator && /^https:|^http:\/\/localhost/.test(location.href)) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(e => console.warn("SW:", e)));
}
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && $("onbModal").classList.contains("open") && S.settings.onboarded) $("onbModal").classList.remove("open");
});
window.addEventListener("storage", e => { if (e.key === KEY && e.newValue) { try { S = normalize(JSON.parse(e.newValue)); resolveCache.clear(); refreshAll(); } catch (err) {} } });

/* ---------- Mulai ---------- */
$("verTxt").textContent = "v" + VERSION;
$("nCcy").innerHTML = NEWS_CCY.map(c => `<option>${c}</option>`).join("");
$("lot").value = S.settings.lotStep >= 0.01 ? S.settings.lotStep : 0.01;
applyTheme(); renderTagInputs(); pickSym(curSym);
onDataChange();
tick(); setInterval(tick, 30000);
setInterval(() => { renderNewsSoon(); update(); if (curView === "pos") renderLive(); }, 60000);
Cloud.chip();
if (Cloud.sess && Cloud.cfg()) Cloud.afterLogin(false).catch(e => Cloud.fail(e));
if (!S.settings.onboarded) openOnboarding();
go(location.hash.slice(1) || "dash");

// Ekspos minimal untuk debugging di konsol
window.RiskDesk = { version: VERSION, get state() { return S; }, calc, parseMt5Html, parseCsvJournal };
})();
