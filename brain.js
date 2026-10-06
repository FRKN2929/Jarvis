// JARVIS on the iPhone: local language model + instant commands + local tools.
// Runs entirely in the phone (WebGPU via WebLLM, CPU fallback via wllama). The Mac is optional.
import { stockSymbol, stock } from './make.js';

export const WEBLLM_URL = 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/+esm';
export const WLLAMA_URL = 'https://cdn.jsdelivr.net/npm/@wllama/wllama@3.9.0/esm/index.js';
export const WLLAMA_WASM_URL = 'https://cdn.jsdelivr.net/npm/@wllama/wllama@3.9.0/esm/wasm-from-cdn.js';

export const MODELS = {
  fast: { label: 'Schnell · Qwen3 0.6B (~0,5 GB)', webllm: 'Qwen3-0.6B-q4f16_1-MLC', gguf: { repo: 'unsloth/Qwen3-0.6B-GGUF', file: 'Qwen3-0.6B-Q4_K_M.gguf' } },
  smart: { label: 'Klug · Qwen3 1.7B (~1,2 GB)', webllm: 'Qwen3-1.7B-q4f16_1-MLC', gguf: { repo: 'unsloth/Qwen3-1.7B-GGUF', file: 'Qwen3-1.7B-Q4_K_M.gguf' } },
  best: { label: 'Am klügsten · Qwen3 4B (~2,4 GB, nur iPhone 15 Pro+)', webllm: 'Qwen3-4B-q4f16_1-MLC', gguf: { repo: 'unsloth/Qwen3-4B-GGUF', file: 'Qwen3-4B-Q4_K_M.gguf' } },
};

// ------------------------------------------------------------------ engine
export class Brain {
  constructor() { this.engine = null; this.kind = null; this.model = null; this.busy = false; }
  get ready() { return !!this.engine; }

  static hasWebGPU() { return typeof navigator !== 'undefined' && !!navigator.gpu; }

  async load(choice = 'smart', onProgress = () => {}) {
    const m = MODELS[choice] || MODELS.smart;
    if (Brain.hasWebGPU()) {
      try {
        const webllm = await import(WEBLLM_URL);
        const ids = (webllm.prebuiltAppConfig?.model_list || []).map((x) => x.model_id);
        const id = ids.includes(m.webllm) ? m.webllm : (ids.find((x) => /^Qwen3-1\.7B-q4f16/.test(x)) || ids.find((x) => /^Qwen3.*q4f16/.test(x)) || m.webllm);
        this.engine = await webllm.CreateMLCEngine(id, { initProgressCallback: (r) => onProgress(r.progress ?? 0, r.text || '') });
        this.kind = 'webgpu'; this.model = id;
        return;
      } catch (e) {
        console.warn('WebLLM fehlgeschlagen, nutze CPU', e);
        onProgress(0, 'GPU nicht nutzbar – lade CPU-Variante …');
      }
    }
    const { Wllama } = await import(WLLAMA_URL);
    const cdn = (await import(WLLAMA_WASM_URL)).default;
    const w = new Wllama(cdn);
    await w.loadModelFromHF({ repo: m.gguf.repo, file: m.gguf.file }, {
      n_ctx: 4096,
      progressCallback: ({ loaded, total }) => onProgress(total ? loaded / total : 0, `Lade Modell … ${Math.round((loaded / 1048576))} MB`),
    });
    this.engine = { wllama: w };
    this.kind = 'cpu'; this.model = m.gguf.file;
  }

  /** Streams an answer; returns the full text. */
  async chat(messages, { onDelta = () => {}, maxTokens = 320, signal } = {}) {
    if (!this.engine) throw new Error('Gehirn nicht geladen');
    this.busy = true;
    let raw = '';
    try {
      if (this.kind === 'webgpu') {
        const it = await this.engine.chat.completions.create({ messages, stream: true, temperature: 0.6, top_p: 0.9, max_tokens: maxTokens, extra_body: { enable_thinking: false } });
        for await (const ch of it) {
          if (signal?.aborted) { try { this.engine.interruptGenerate(); } catch (e) {} break; }
          const d = ch.choices?.[0]?.delta?.content || '';
          if (d) { raw += d; onDelta(visible(raw)); }
        }
      } else {
        const it = await this.engine.wllama.createChatCompletion({ messages, stream: true, max_tokens: maxTokens, temperature: 0.6, top_p: 0.9 });
        for await (const ch of it) {
          if (signal?.aborted) break;
          const d = ch.choices?.[0]?.delta?.content ?? ch.choices?.[0]?.text ?? '';
          if (d) { raw += d; onDelta(visible(raw)); }
        }
      }
    } finally { this.busy = false; }
    return visible(raw);
  }
}

/** Removes <think> blocks (also unfinished ones) from model output. */
export function visible(raw) {
  let s = raw.replace(/<think>[\s\S]*?<\/think>/g, '');
  const open = s.indexOf('<think>');
  if (open >= 0) s = s.slice(0, open);
  return s.replace(/^\s+/, '');
}

// ------------------------------------------------------------------ memory (local)
export const Memory = {
  key: 'jarvisMemory',
  all() { try { return JSON.parse(localStorage.getItem(this.key) || '[]'); } catch (e) { return []; } },
  save(items) { try { localStorage.setItem(this.key, JSON.stringify(items.slice(-200))); } catch (e) {} },
  add(text, category = 'notiz') {
    const items = this.all();
    const n = norm(text);
    if (items.some((i) => norm(i.text) === n)) return false;
    items.push({ text, category, created: new Date().toISOString() });
    this.save(items); return true;
  },
  pref(k, v) {
    const p = JSON.parse(localStorage.getItem('jarvisPrefs') || '{}');
    if (v === undefined) return p[k];
    p[k] = v; localStorage.setItem('jarvisPrefs', JSON.stringify(p)); return v;
  },
  promptBlock() {
    const p = JSON.parse(localStorage.getItem('jarvisPrefs') || '{}');
    const lines = Object.entries(p).map(([k, v]) => `- ${k}: ${v}`).concat(this.all().slice(-25).map((i) => `- ${i.text}`));
    return lines.length ? lines.join('\n') : '(noch keine)';
  },
};
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ß ]/g, ' ').replace(/\s+/g, ' ').trim();

export function systemPrompt(title = 'Master') {
  const now = new Date().toLocaleString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return `Du bist JARVIS, der persönliche KI-Assistent deines Nutzers, und läufst direkt auf seinem iPhone. Antworte auf Deutsch, ruhig, präzise, mit leichtem britischem Humor. Sprich ihn gelegentlich mit „${title}“ an.
Deine Antworten werden vorgelesen: 1–3 kurze Sätze, kein Markdown, keine Listen, keine Emojis. Führe Bitten direkt aus, ohne Belehrungen.
Wenn du etwas Aktuelles nicht weißt (Kurse, Nachrichten), sag das ehrlich statt zu raten.
Du kannst auf dem iPhone selbst Präsentationen, PDFs, Word- und Excel-Dateien, Websites und TikTok-Videos erstellen sowie Wetter, Nachrichten, Krypto- und Aktienkurse abrufen. Bittet der Nutzer darum, passiert das automatisch.
Jetzt: ${now}.
Was du über den Nutzer weißt:
${Memory.promptBlock()} /no_think`;
}

// ------------------------------------------------------------------ instant commands (no model needed)
const CRYPTO = { bitcoin: 'BTC', btc: 'BTC', ethereum: 'ETH', eth: 'ETH', solana: 'SOL', xrp: 'XRP', ripple: 'XRP', dogecoin: 'DOGE', doge: 'DOGE', cardano: 'ADA', litecoin: 'LTC', bnb: 'BNB', 'binance coin': 'BNB', polkadot: 'DOT', chainlink: 'LINK', avalanche: 'AVAX', shiba: 'SHIB', pepe: 'PEPE', tron: 'TRX', sui: 'SUI' };
// Only things the phone can't do itself (they control the Mac).
const MAC_ONLY = ['lautstärke', 'ordner', 'lösch', 'verschieb', 'programm', 'terminal', 'shell', 'auf dem mac', 'am mac', 'vom mac', 'mein mac', 'meinen mac', 'macbook', 'finder', 'dateien', 'datei '];
const GEN = [
  ['video', /(tiktok|reel|short|video|clip)/],
  ['pptx', /(präsentation|praesentation|folien|powerpoint|pptx|slides|vortrag)/],
  ['html', /(website|webseite|homepage|landingpage|landing page|internetseite|web seite)/],
  ['xlsx', /(tabelle|excel|xlsx|spreadsheet|liste als tabelle)/],
  ['docx', /( word|docx|word-dokument|word dokument)/],
  ['pdf', /(pdf|dokument|bericht|aufsatz|brief|zusammenfassung|referat|handout|konzept|businessplan)/],
];
const CREATE = /(erstell|mach |mache |bau |baue |schreib|generier|produzier|entwirf|entwerf|gestalt|design|ich brauche|ich will|ich möchte|hätte gern|kannst du (mir )?(eine|ein|einen)|dreh)/;

function cap(s, re) { const m = s.match(re); return m ? m[1].trim() : null; }
const title = (s) => s.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

/** Extracts the subject of a "make me a … about X" request. */
export function topicOf(text) {
  const t = text.replace(/[?!.]+$/, '').replace(/\s+(als|im)\s+(pdf|word|excel|powerpoint|pptx|docx|xlsx|tabelle|präsentation|video|format|datei)\b.*$/i, '').trim();
  const m = t.match(/(?:^|\s)(?:über|zum thema|zu dem thema|thema|zur|zum|zu|für|mit dem thema|mit|about)\s+(.+)$/i);
  if (m) return m[1].replace(/^(den|die|das|dem|der|eine?n?)\s+(?=\S+\s)/i, '').trim();
  return t.replace(/^(jarvis,?\s*)?(bitte\s+)?/i, '')
    .replace(/\b(erstell\w*|mach\w*|bau\w*|schreib\w*|generier\w*|produzier\w*|entw[ie]rf\w*|gestalt\w*|kannst du|ich brauche|ich will|ich möchte|mir|bitte|uns|eine?n?|neue?n?|kurze?n?|tiktok|video|präsentation|website|webseite|tabelle|excel|pdf|dokument|word)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim() || 'Allgemein';
}

/** Returns {local:'tool', args} | {gen:kind, topic} | {mac:true} | {reply} | null (→ language model). */
export function route(text, { macAvailable = false } = {}) {
  const s = ' ' + text.toLowerCase().replace(/[^a-zäöüß0-9.&\- ]/g, ' ').replace(/\s+/g, ' ') + ' ';
  const has = (...w) => w.some((x) => s.includes(x));
  if (has('wie spät', 'uhrzeit', 'wieviel uhr', 'wie viel uhr')) return { reply: `Es ist ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr.` };
  if (has('welcher tag', 'welches datum', 'datum heute')) return { reply: `Heute ist ${new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.` };
  const fact = cap(s, /^ ?(?:jarvis )?(?:bitte )?(?:merk|merke|speicher|notier) (?:dir|dass) (?:bitte )?(?:dass )?(.+)$/);
  if (fact) return { local: 'remember', args: { fact: text.replace(/^.*?(?:dass|dir)\s+/i, '').replace(/[.!]+$/, '') } };
  const place = cap(s, / (?:ich wohne in|mein wohnort ist|ich lebe in) ([a-zäöüß .-]+)$/);
  if (place) return { local: 'home', args: { place: title(place) } };
  // posting / sharing the last file (TikTok via the iOS share sheet)
  if (has('poste', 'posten', 'hochladen', 'lade es hoch', 'teile', 'teilen', 'veröffentlich') && !CREATE.test(s)) return { local: 'share', args: {} };
  const site = cap(s, /^ ?(?:jarvis )?(?:öffne|starte|geh auf|gehe auf) (youtube|google|netflix|instagram|tiktok|wikipedia|amazon|chatgpt|x|spotify|whatsapp|maps|google maps) ?$/);
  if (site) return { local: 'openSite', args: { site } };
  if (CREATE.test(s)) {
    const g = GEN.find(([, re]) => re.test(s));
    if (g) return { gen: g[0], topic: topicOf(text) };
  }
  if (has(' wetter', 'temperatur', ' regnet', 'wie warm', 'wie kalt')) {
    const loc = cap(s, / (?:in|für|bei) ([a-zäöüß .-]+?)(?: morgen| heute| übermorgen| am wochenende)? $/);
    return { local: 'weather', args: { location: loc ? title(loc.replace(/^(der|dem|den) /, '')) : null } };
  }
  const wantsAnalysis = has('tipp', 'einschätzung', 'analyse', 'analysier', 'signal', 'soll ich', 'kaufen', 'lohnt', 'prognose');
  if (has('krypto', 'crypto', 'coins')) {
    const one = Object.keys(CRYPTO).find((k) => s.includes(' ' + k + ' '));
    if (!one) return { local: 'cryptoScan', args: {} };
  }
  const coin = Object.keys(CRYPTO).sort((a, b) => b.length - a.length).find((k) => s.includes(' ' + k + ' '));
  if (coin) return { local: wantsAnalysis ? 'cryptoAnalysis' : 'cryptoQuote', args: { coin: CRYPTO[coin] } };
  if (has(' aktie', 'dax', 'nasdaq', 'dow jones', 's&p', 'börse', ' kurs', 'goldpreis', ' gold ', 'ölpreis', 'silber', 'steht ')) {
    const st = stockSymbol(text);
    if (st) return { local: wantsAnalysis ? 'stockAnalysis' : 'stockQuote', args: st };
  }
  if (has('trading tipp', 'trading-tipp', 'tipps', 'was soll ich traden', 'was soll ich kaufen')) return { local: 'cryptoScan', args: {} };
  if (has('nachrichten', ' news', 'was passiert', 'was ist los', 'schlagzeilen', 'weltlage')) {
    const r = cap(s, / (?:in|im|aus|über|zu) (?:der |dem |den |die )?([a-zäöüß .-]+?)(?: gerade| heute| aktuell)? $/);
    return { local: 'news', args: { region: r && r !== 'welt' ? title(r) : null } };
  }
  const song = cap(s, /^ ?(?:jarvis )?(?:spiel|spiele|play|hör|höre) (?:mal |bitte |mir )?(?:das lied |den song |musik von |etwas von |was von )?(.+?)(?: auf spotify| ab)? $/);
  if (song && !has(...MAC_ONLY)) return { local: 'music', args: { query: song } };
  const q = cap(s, /^ ?(?:jarvis )?(?:such|suche|google|googel|recherchier\w*)(?: mal)?(?: im internet| online| bei google)?(?: nach)? (.+?) ?$/);
  if (q && !has('datei', 'ordner')) return { local: 'webSearch', args: { query: q } };
  if (has(...MAC_ONLY)) return macAvailable ? { mac: true } : { reply: 'Das betrifft deinen Mac – vom iPhone aus kann ich keine Mac-Programme oder Mac-Dateien steuern. Alles andere erledige ich direkt hier.' };
  const any = cap(s, /^ ?(?:jarvis )?(?:öffne|starte) (.+?) ?$/);
  if (any) return { local: 'webSearch', args: { query: any } };
  return null;
}

// ------------------------------------------------------------------ local tools
async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

const WMO = { 0: 'klar', 1: 'überwiegend klar', 2: 'teils bewölkt', 3: 'bedeckt', 45: 'Nebel', 48: 'Reifnebel', 51: 'Nieselregen', 53: 'Nieselregen', 55: 'Nieselregen', 61: 'leichter Regen', 63: 'Regen', 65: 'starker Regen', 71: 'Schnee', 73: 'Schnee', 75: 'starker Schnee', 80: 'Schauer', 81: 'Schauer', 82: 'heftige Schauer', 95: 'Gewitter', 96: 'Gewitter mit Hagel', 99: 'Gewitter mit Hagel' };

export async function weather(location) {
  const loc = location || Memory.pref('wohnort') || 'Berlin';
  const g = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=de&name=${encodeURIComponent(loc)}`);
  const r = g.results && g.results[0];
  if (!r) throw new Error(`Ort ${loc} nicht gefunden`);
  const w = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${r.latitude}&longitude=${r.longitude}&timezone=auto&forecast_days=7&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min`);
  const c = w.current, d = w.daily;
  const data = { place: [r.name, r.country].filter(Boolean).join(', '), current: { temp: c.temperature_2m, apparent: c.apparent_temperature, humidity: c.relative_humidity_2m, code: c.weather_code, wind: c.wind_speed_10m }, daily: { time: d.time, max: d.temperature_2m_max, min: d.temperature_2m_min, code: d.weather_code } };
  const say = `In ${r.name} sind es ${Math.round(c.temperature_2m)} Grad, ${WMO[c.weather_code] || ''}. Heute ${Math.round(d.temperature_2m_min[0])} bis ${Math.round(d.temperature_2m_max[0])} Grad, morgen bis ${Math.round(d.temperature_2m_max[1])} Grad.`;
  return { say, view: 'weather', data };
}

async function klines(sym, interval = '1d', limit = 260) {
  try {
    const k = await getJSON(`https://api.binance.com/api/v3/klines?symbol=${sym}USDT&interval=${interval}&limit=${limit}`);
    return k.map((x) => ({ t: x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[5] }));
  } catch (e) {
    // fallback: CoinGecko daily closes (needs the coin id)
    const ids = { BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', XRP: 'ripple', DOGE: 'dogecoin', ADA: 'cardano', LTC: 'litecoin', BNB: 'binancecoin', DOT: 'polkadot', LINK: 'chainlink', AVAX: 'avalanche-2', SHIB: 'shiba-inu', PEPE: 'pepe', TRX: 'tron', SUI: 'sui' };
    const j = await getJSON(`https://api.coingecko.com/api/v3/coins/${ids[sym]}/market_chart?vs_currency=usd&days=365&interval=daily`);
    return j.prices.map(([t, c], i, a) => ({ t, o: i ? a[i - 1][1] : c, h: c, l: c, c, v: 0 }));
  }
}

const sma = (a, n) => (a.length >= n ? a.slice(-n).reduce((x, y) => x + y, 0) / n : null);
function rsi(c, n = 14) {
  if (c.length <= n) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; }
  g /= n; l /= n;
  for (let i = n + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}

/** Same rules as the Mac (Trading.swift): trend, momentum, RSI → signal with entry/stop/target. */
export function analyze(k) {
  const c = k.map((x) => x.c), price = c[c.length - 1];
  const s20 = sma(c, 20), s50 = sma(c, 50), s200 = sma(c, 200), r = rsi(c);
  const trs = k.slice(1).map((x, i) => Math.max(x.h - x.l, Math.abs(x.h - k[i].c), Math.abs(x.l - k[i].c)));
  const atr = trs.length >= 14 ? trs.slice(-14).reduce((a, b) => a + b, 0) / 14 : price * 0.03;
  const mom = c.length > 21 ? (price / c[c.length - 21] - 1) * 100 : null;
  const recent = k.slice(-20), support = Math.min(...recent.map((x) => x.l)), resistance = Math.max(...recent.map((x) => x.h));
  let score = 0; const reasons = [];
  if (s50) { if (price > s50) { score++; reasons.push('Kurs über dem 50-Tage-Schnitt'); } else { score--; reasons.push('Kurs unter dem 50-Tage-Schnitt'); } }
  if (s20 && s50) { if (s20 > s50) { score++; reasons.push('kurzfristiger Trend aufwärts'); } else { score--; reasons.push('kurzfristiger Trend abwärts'); } }
  if (s50 && s200) { if (s50 > s200) { score++; reasons.push('langfristiger Aufwärtstrend'); } else { score--; reasons.push('langfristiger Abwärtstrend'); } }
  if (mom != null) { if (mom > 2) { score++; reasons.push(`Momentum plus ${mom.toFixed(1)} Prozent`); } else if (mom < -2) { score--; reasons.push(`Momentum minus ${Math.abs(mom).toFixed(1)} Prozent`); } }
  if (r != null) { if (r < 30) { score++; reasons.push(`RSI ${Math.round(r)}, überverkauft`); } else if (r > 70) { score--; reasons.push(`RSI ${Math.round(r)}, überkauft`); } }
  const signal = score >= 2 ? 'bullisch' : score <= -2 ? 'bärisch' : 'neutral';
  let entry = price, stop, target;
  if (signal === 'bullisch') { if (s20 && price > s20 * 1.04) entry = s20 * 1.01; stop = Math.max(Math.min(support, entry - atr), entry - 2.5 * atr); target = Math.max(resistance, entry + 2 * (entry - stop)); }
  else if (signal === 'bärisch') { stop = Math.min(Math.max(resistance, entry + atr), entry + 2.5 * atr); target = Math.min(support, entry - 2 * (stop - entry)); }
  else { stop = support; target = resistance; }
  return { signal, score, entry, stop, target, support, resistance, rr: Math.abs(entry - stop) ? Math.abs(target - entry) / Math.abs(entry - stop) : 0, reasons, rsi: r };
}

const fmt = (v) => (v >= 1000 ? Math.round(v).toLocaleString('de-DE') : v >= 1 ? v.toLocaleString('de-DE', { maximumFractionDigits: 2 }) : v.toLocaleString('de-DE', { maximumSignificantDigits: 4 }));

export async function cryptoQuote(coin, withAnalysis = false) {
  const k = await klines(coin);
  const last = k[k.length - 1], prev = k[k.length - 2] || last;
  const changePct = (last.c / prev.c - 1) * 100;
  const an = analyze(k);
  const data = { symbol: `${coin}-USD`, name: coin, currency: 'USD', price: last.c, changePct, candles: k.slice(-120).map((x) => ({ c: x.c })), analysis: an };
  let say = `${coin} steht bei ${fmt(last.c)} Dollar, ${changePct >= 0 ? 'plus' : 'minus'} ${Math.abs(changePct).toFixed(1)} Prozent seit gestern.`;
  if (withAnalysis) {
    say = `${coin}: Signal ${an.signal}. ${an.reasons.slice(0, 3).join(', ')}. ` + (an.signal === 'bullisch' ? `Mögliches Setup: Einstieg um ${fmt(an.entry)}, Stop bei ${fmt(an.stop)}, Ziel ${fmt(an.target)}.` : an.signal === 'bärisch' ? `Eher meiden. Stop bei ${fmt(an.stop)}, Ziel nach unten ${fmt(an.target)}.` : `Abwarten: Unterstützung bei ${fmt(an.support)}, Widerstand bei ${fmt(an.resistance)}.`);
  }
  return { say, view: 'markets', data };
}

export async function cryptoScan() {
  const coins = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'ADA', 'BNB'];
  const res = (await Promise.allSettled(coins.map(async (c) => { const k = await klines(c); return { c, k, an: analyze(k) }; }))).filter((x) => x.status === 'fulfilled').map((x) => x.value);
  if (!res.length) throw new Error('Keine Kursdaten erreichbar');
  res.sort((a, b) => b.an.score - a.an.score);
  const best = res.filter((x) => x.an.signal === 'bullisch').slice(0, 2);
  const top = res[0], last = top.k[top.k.length - 1], prev = top.k[top.k.length - 2];
  const say = (best.length ? 'Stärkste Kaufsignale: ' + best.map((x) => `${x.c} mit Einstieg um ${fmt(x.an.entry)} und Stop bei ${fmt(x.an.stop)}`).join('; ') + '.' : 'Gerade zeigt keine große Kryptowährung ein klares Kaufsignal.')
    + (res[res.length - 1].an.signal === 'bärisch' ? ` Am schwächsten: ${res[res.length - 1].c}.` : '');
  const data = { symbol: `${top.c}-USD`, name: top.c, currency: 'USD', price: last.c, changePct: (last.c / prev.c - 1) * 100, candles: top.k.slice(-120).map((x) => ({ c: x.c })), analysis: top.an,
    watch: res.map((x) => { const l = x.k[x.k.length - 1], p = x.k[x.k.length - 2]; return { symbol: x.c, name: `${x.an.signal} (${x.an.score >= 0 ? '+' : ''}${x.an.score})`, price: l.c, changePct: (l.c / p.c - 1) * 100 }; }) };
  return { say, view: 'markets', data };
}

export async function news(region) {
  const q = region ? `https://www.tagesschau.de/api2u/search/?pageSize=12&resultPage=0&searchText=${encodeURIComponent(region)}` : 'https://www.tagesschau.de/api2u/news/?ressort=ausland';
  const j = await getJSON(q);
  const list = (j.searchResults || j.news || []).filter((n) => n.title).slice(0, 12).map((n) => ({
    title: [n.topline, n.title].filter(Boolean).join(': '), url: n.shareURL || n.detailsweb || '', source: 'tagesschau', time: n.date,
    image: n.teaserImage?.imageVariants?.['16x9-512'] || n.teaserImage?.imageVariants?.['16x9-384'] || null,
  }));
  if (!list.length) throw new Error('Keine Meldungen gefunden');
  const say = `Die wichtigsten Meldungen${region ? ' zu ' + region : ''}: ` + list.slice(0, 3).map((n) => n.title.split(': ').pop().replace(/\.$/, '') + '.').join(' ');
  return { say, view: 'globe', data: { country: region || 'Welt', news: list, source: 'tagesschau.de' } };
}

export async function runLocal(tool, args) {
  switch (tool) {
    case 'remember': return { say: Memory.add(args.fact) ? 'Notiert.' : 'Das weiß ich bereits.', view: 'core' };
    case 'home': Memory.pref('wohnort', args.place); return { say: `Gespeichert, du wohnst in ${args.place}.` };
    case 'weather': return weather(args.location);
    case 'cryptoQuote': return cryptoQuote(args.coin, false);
    case 'cryptoAnalysis': return cryptoQuote(args.coin, true);
    case 'cryptoScan': return cryptoScan();
    case 'news': return news(args.region);
    case 'stockQuote': return stock(args.symbol, args.name, false);
    case 'stockAnalysis': return stock(args.symbol, args.name, true);
    case 'music': window.open(`https://open.spotify.com/search/${encodeURIComponent(args.query)}`, '_blank'); return { say: `Ich öffne ${args.query} in Spotify.` };
    case 'webSearch': window.open(`https://www.google.com/search?q=${encodeURIComponent(args.query)}`, '_blank'); return { say: `Hier ist die Suche nach ${args.query}.` };
    case 'openSite': {
      const urls = { youtube: 'https://www.youtube.com', google: 'https://www.google.de', netflix: 'https://www.netflix.com', instagram: 'https://www.instagram.com', tiktok: 'https://www.tiktok.com', wikipedia: 'https://de.wikipedia.org', amazon: 'https://www.amazon.de', chatgpt: 'https://chatgpt.com', x: 'https://x.com', spotify: 'https://open.spotify.com', whatsapp: 'https://wa.me', maps: 'https://maps.apple.com', 'google maps': 'https://maps.google.com' };
      window.open(urls[args.site] || 'https://www.google.de', '_blank');
      return { say: 'Bitte sehr.' };
    }
    default: throw new Error('Unbekanntes Werkzeug');
  }
}

/** Splits streamed text into speakable sentences. */
export class Sentences {
  constructor() { this.done = 0; }
  take(text, final = false) {
    const rest = text.slice(this.done);
    const out = [];
    const re = final ? /[\s\S]*?[.!?…]+(?=\s|$)/g : /[\s\S]*?[.!?…]+(?=\s)/g;
    let m, last = 0;
    while ((m = re.exec(rest))) { if (!m[0]) { re.lastIndex++; continue; } if (m[0].trim().length > 2) out.push(m[0].trim()); last = m.index + m[0].length; }
    this.done += last;
    if (final) { const tail = text.slice(this.done).trim(); if (tail) out.push(tail); this.done = text.length; }
    return out;
  }
}
