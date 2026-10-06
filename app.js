// JARVIS mobile – UI, iPhone brain, optional Mac link.
import { Brain, MODELS, Memory, route, runLocal, systemPrompt, Sentences } from './brain.js';
import { generate, KINDS, unlockAudio } from './make.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (v, d = 2) => (v == null || !isFinite(v)) ? '—' : Number(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
const params = new URLSearchParams(location.search);

let token = store.get('jarvisToken', null);
let mode = store.get('jarvisMode', 'auto');
let modelChoice = store.get('jarvisModel', 'smart');
let es = null, macOnline = false, macTurn = false, confirmId = null, level = 0, uiState = 'sleeping';
let rec = null, listening = false;
const brain = new Brain();
const history = [];
let abort = null;
let macHost = false;          // true only when this page is served by the Mac app
let lastMade = null;          // last file generated on the phone
const made = [];              // files generated in this session

// ---------------------------------------------------------------- brain
function setBrainChip() {
  const c = $('brainChip');
  if (brain.ready) { c.textContent = `GEHIRN · ${brain.kind === 'webgpu' ? 'GPU' : 'CPU'}`; c.classList.add('on'); }
  else { c.textContent = 'GEHIRN AUS'; c.classList.remove('on'); }
  $('engineInfo').textContent = brain.ready ? `Aktiv: ${brain.model} (${brain.kind === 'webgpu' ? 'iPhone-GPU' : 'CPU'})` : (Brain.hasWebGPU() ? 'WebGPU verfügbar – schnell.' : (window.isSecureContext ? 'Kein WebGPU – CPU-Modus (langsamer). iOS 26 nutzt die GPU.' : 'Für das Gehirn wird HTTPS benötigt (Tailscale) – siehe README.'));
  renderOnboarding();
}
async function loadBrain() {
  if (brain.ready) return;
  $('loadBrain').disabled = true;
  try {
    try { await navigator.storage?.persist?.(); } catch (e) {}
    if (params.get('engine') === 'mock') {
      brain.engine = { mock: true }; brain.kind = 'webgpu'; brain.model = 'mock';
      // test brain (no download): echoes chat, returns well-formed content for the generators
      const MOCK = {
        Präsentation: 'TITEL: Testpräsentation\nUNTERTITEL: Erstellt vom Test-Gehirn\n# Einleitung\n- Erster Punkt\n- Zweiter Punkt\n- Dritter Punkt\n# Fakten\n- Größe und Bedeutung\n- Zahlen: 42 Prozent\n# Fazit\n- Zusammenfassung\n- Ausblick',
        Dokument: 'TITEL: Testdokument\n# Einleitung\nDies ist ein Absatz mit Umlauten: ä ö ü ß. Er hat mehrere Sätze. Noch einer.\n# Hauptteil\nZweiter Abschnitt mit Inhalt.\n# Fazit\nSchluss.',
        Tabelle: 'TITEL: Städte\nStadt;Einwohner;Bundesland\nBerlin;3755000;Berlin\nHamburg;1892000;Hamburg\nMünchen;1512000;Bayern\nKöln;1084000;NRW',
        Website: 'TITEL: Café Morgenrot\nUNTERTITEL: Der beste Kaffee der Stadt.\nBUTTON: Tisch reservieren\n# Unser Kaffee\nFrisch geröstet, jeden Morgen.\n# Frühstück\nRegional und hausgemacht.\n# Besuch uns\nMo–So 8–18 Uhr.',
        TikTok: 'TITEL: Kaffee-Fakten\nHOOK: Das wusstest du nicht über Kaffee\n# Kaffee ist eigentlich eine Frucht\n# Finnland trinkt am meisten Kaffee\n# Espresso hat weniger Koffein pro Tasse\nCAPTION: Drei Kaffee-Fakten, die dich überraschen.\nHASHTAGS: #kaffee #fakten #fyp #wissen',
      };
      brain.chat = async (msgs, { onDelta = () => {} } = {}) => {
        const last = msgs[msgs.length - 1].content;
        const key = Object.keys(MOCK).find((k) => last.includes('genau diesem Format') && last.includes(k === 'Dokument' ? 'Schreibe ein Dokument' : k === 'TikTok' ? 'TikTok-Video' : k));
        const t = key ? MOCK[key] : `Ich bin JARVIS auf deinem iPhone. Du sagtest: ${last.replace(' /no_think', '')}.`;
        let s = ''; for (const w of t.split(' ')) { s += w + ' '; onDelta(s); await new Promise((r) => setTimeout(r, 8)); } return s.trim();
      };
    } else {
      await brain.load(modelChoice, (p, txt) => { $('progBar').style.width = `${Math.round(p * 100)}%`; $('progTxt').textContent = txt.slice(0, 90); const ob = $('obProg'); if (ob) { ob.style.width = `${Math.round(p * 100)}%`; $('obTxt').textContent = txt.slice(0, 80); } });
    }
    store.set('jarvisBrainLoaded', '1');
    $('progTxt').textContent = 'Bereit.';
    say('Gehirn geladen. Ich laufe jetzt direkt auf deinem iPhone.');
  } catch (e) {
    $('progTxt').textContent = 'Fehler: ' + (e.message || e);
    $('reply').textContent = 'Das Gehirn konnte nicht geladen werden: ' + (e.message || e);
  } finally { $('loadBrain').disabled = false; setBrainChip(); }
}
function renderOnboarding() {
  const el = $('onboard');
  if (brain.ready) { el.innerHTML = ''; return; }
  const wasLoaded = store.get('jarvisBrainLoaded', '0') === '1';
  el.innerHTML = `<div class="onb"><b>${wasLoaded ? 'Gehirn starten' : 'Gehirn aufs iPhone laden'}</b><div class="muted" style="margin:6px 0 10px">${wasLoaded ? 'Das Modell liegt schon auf dem iPhone – Start dauert ein paar Sekunden.' : `${esc(MODELS[modelChoice].label)}. Einmaliger Download, danach läuft JARVIS ohne Internet und ohne Mac.`}</div>
    <button class="btn hot" id="obLoad" style="width:100%">${wasLoaded ? 'Starten' : 'Jetzt laden'}</button><div class="prog"><i id="obProg"></i></div><div id="obTxt" class="muted"></div></div>`;
  $('obLoad').onclick = () => { unlockSpeech(); loadBrain(); };
}

// ---------------------------------------------------------------- Mac link (optional)
async function api(path, body) {
  const r = await fetch(path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) { token = null; store.set('jarvisToken', ''); setMac(false); throw new Error('Mac nicht gekoppelt'); }
  return r.json();
}
function setMac(on) {
  macOnline = on;
  const c = $('macChip'); c.textContent = on ? 'MAC ✓' : (token ? 'MAC OFFLINE' : 'MAC —'); c.classList.toggle('on', on);
  const relevant = macHost || !!token;
  c.hidden = !relevant; $('macSection').hidden = !relevant;
  document.querySelectorAll('#mode button[data-m="mac"]').forEach((b) => { b.hidden = !relevant; });
  $('macInfo').textContent = on ? 'Mac verbunden – schwere Aufgaben laufen dort.' : (token ? 'Gekoppelt, aber der Mac ist gerade nicht erreichbar.' : 'Am Mac sagen: „Jarvis, verbinde mein Handy“ und den Code hier eingeben.');
}
function connectMac() {
  if (!token || !macHost) { setMac(false); return; }
  if (es) es.close();
  try { es = new EventSource('/api/events?t=' + encodeURIComponent(token)); } catch (e) { setMac(false); return; }
  es.onopen = () => setMac(true);
  es.onerror = () => { setMac(false); };
  es.onmessage = (e) => { try { fromMac(JSON.parse(e.data)); } catch (err) { console.error(err); } };
}
$('pairBtn').onclick = async () => {
  $('pairErr').textContent = '';
  try {
    const r = await fetch('/api/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: $('pairCode').value }) });
    const j = await r.json();
    if (!j.ok) { $('pairErr').textContent = j.error || 'Fehlgeschlagen'; return; }
    token = j.token; store.set('jarvisToken', token); connectMac(); $('pairErr').textContent = 'Gekoppelt ✓';
  } catch (e) { $('pairErr').textContent = 'Mac nicht erreichbar.'; }
};
document.addEventListener('visibilitychange', () => { if (!document.hidden && token && (!es || es.readyState === 2)) connectMac(); });

let macReply = '';
function fromMac(m) {
  switch (m.type) {
    case 'state': if (macTurn) setState(m.state, m.detail); break;
    case 'reply':
      if (!macTurn) break;
      if (m.reset) macReply = '';
      if (m.delta) macReply += m.delta; else if (m.text != null) { macReply = m.text; if (m.text) speak(m.text, true); }
      $('reply').textContent = macReply.replace(/\s+/g, ' ').trim();
      if (m.done) { if (macReply.trim()) speak(macReply, true); macTurn = false; setState('sleeping'); }
      break;
    case 'speak': if (macTurn) speak(m.text, false); break;
    case 'view': if (macTurn) renderView(m.view, m.data || {}); break;
    case 'code': if (macTurn && m.op === 'end' && m.path) renderView('code', { path: m.path }); break;
    case 'telemetry': lastTele = m; if (curView === 'core') renderView('core', {}); break;
    case 'confirm': confirmId = m.id; $('cfK').textContent = ({ destructive: 'ACHTUNG', financial: 'GELD', system: 'SYSTEM' })[m.risk] || 'BESTÄTIGUNG'; $('cfT').textContent = m.title || ''; $('cfD').textContent = m.detail || ''; $('confirm').hidden = false; break;
    case 'confirm_close': $('confirm').hidden = true; confirmId = null; break;
  }
}
$('cfYes').onclick = () => { api('/api/confirm', { id: confirmId, accept: true }).catch(() => {}); $('confirm').hidden = true; };
$('cfNo').onclick = () => { api('/api/confirm', { id: confirmId, accept: false }).catch(() => {}); $('confirm').hidden = true; };
$('macMute').onchange = () => api('/api/mute', { value: $('macMute').checked }).catch(() => {});

// ---------------------------------------------------------------- command flow
const STATE = { sleeping: 'Bereit', listening: 'Hört zu', thinking: 'Denkt nach', speaking: 'Spricht', error: 'Störung' };
function setState(s, detail) { uiState = s; $('state').textContent = detail || STATE[s] || s; }
function say(text) { $('reply').textContent = text; speak(text, true); }

async function send(text) {
  text = (text || '').trim();
  if (!text) return;
  unlockSpeech();
  $('you').textContent = text; $('text').value = ''; $('reply').textContent = '';
  if (abort) abort.abort();
  stopSpeaking();
  const r = route(text, { macAvailable: macOnline && mode !== 'phone' });
  const toMac = (mode === 'mac' && macOnline) || (r && r.mac);
  if (toMac) {
    macTurn = true; macReply = ''; setState('thinking', 'Mac arbeitet …');
    try { await api('/api/command', { text }); } catch (e) { macTurn = false; setState('error'); $('reply').textContent = e.message; }
    return;
  }
  if (r && r.reply) { setState('speaking'); say(r.reply); remember(text, r.reply); setState('sleeping'); return; }
  if (r && r.gen) { await makeOnPhone(r.gen, r.topic, text); return; }
  if (r && r.local === 'share') {
    if (!lastMade) { say('Ich habe noch nichts erstellt, das ich teilen könnte. Sag zum Beispiel: Mach mir ein TikTok Video über Kaffee.'); return; }
    renderMade(lastMade, true);
    say(lastMade.kind === 'video' ? 'Tippe auf „Teilen“ und wähle TikTok – die Beschreibung habe ich darunter bereitgelegt.' : 'Tippe auf „Teilen“, um die Datei zu senden oder in Dateien zu sichern.');
    return;
  }
  if (r && r.local) {
    setState('thinking', 'Lokal …');
    try {
      const res = await runLocal(r.local, r.args);
      if (res.view) renderView(res.view, res.data || {});
      say(res.say); remember(text, res.say);
    } catch (e) {
      if (macOnline && mode !== 'phone') { macTurn = true; setState('thinking', 'Frage den Mac …'); api('/api/command', { text }).catch(() => {}); return; }
      say('Das hat gerade nicht geklappt: ' + (e.message || e));
    }
    setState('sleeping');
    return;
  }
  // free conversation → the brain on the phone (or the Mac as fallback)
  if (!brain.ready) {
    if (macOnline) { macTurn = true; setState('thinking', 'Mac denkt …'); api('/api/command', { text }).catch(() => {}); return; }
    say('Lade zuerst das Gehirn – oben auf „Jetzt laden“ tippen.'); return;
  }
  setState('thinking');
  abort = new AbortController();
  const sent = new Sentences();
  const messages = [{ role: 'system', content: systemPrompt(store.get('jarvisTitle', 'Master')) }, ...history.slice(-8), { role: 'user', content: text + ' /no_think' }];
  try {
    const full = await brain.chat(messages, {
      signal: abort.signal,
      onDelta: (t) => { $('reply').textContent = t; if (uiState !== 'speaking') setState('speaking'); for (const s of sent.take(t)) speak(s, false); level = 1; },
    });
    for (const s of sent.take(full, true)) speak(s, false);
    remember(text, full);
  } catch (e) { say('Fehler im Gehirn: ' + (e.message || e)); }
  setState('sleeping');
}
// ---------------------------------------------------------------- files made on the phone
async function makeOnPhone(kind, topic, text) {
  if (!brain.ready) {
    if (macOnline && mode !== 'phone') { macTurn = true; setState('thinking', 'Mac arbeitet …'); api('/api/command', { text }).catch(() => {}); return; }
    say('Dafür brauche ich das Gehirn – tippe oben auf „Jetzt laden“.'); return;
  }
  if (brain.busy) { say('Einen Moment, ich bin noch mit der letzten Aufgabe beschäftigt.'); return; }
  const label = KINDS[kind].label;
  setState('thinking', `${label} …`);
  speak(`Sehr wohl. Ich erstelle ${kind === 'video' ? 'das Video' : kind === 'html' ? 'die Website' : kind === 'xlsx' ? 'die Tabelle' : kind === 'pptx' ? 'die Präsentation' : 'das Dokument'}.`, true);
  curView = 'making';
  $('view').innerHTML = `<div class="card"><h3>${esc(label.toUpperCase())} <span id="mkStat">startet …</span></h3><div class="big" style="font-size:24px">${esc(topic)}</div><pre class="live" id="mkLive"></pre></div>`;
  try {
    const res = await generate(kind, topic, brain, {
      onStatus: (t) => { const e = $('mkStat'); if (e) e.textContent = t; setState('thinking', t); },
      onText: (t) => { const e = $('mkLive'); if (e) e.textContent = t.slice(-700); },
    });
    const item = { kind, topic, ...res, url: URL.createObjectURL(res.file), created: new Date() };
    lastMade = item; made.unshift(item); if (made.length > 12) URL.revokeObjectURL(made.pop().url);
    renderMade(item);
    say(res.say); remember(text, res.say);
  } catch (e) {
    say(`${label} hat nicht geklappt: ${e.message || e}`);
  }
  setState('sleeping');
}
function renderMade(m, highlightShare = false) {
  curView = 'made';
  const s = m.spec || {};
  let body = '';
  if (m.kind === 'pptx') body = `<div class="slides"><div><b>${esc(s.title)}</b>${esc(s.subtitle || '')}</div>${(s.slides || []).map((x) => `<div><b>${esc(x.title)}</b>${(x.bullets || []).map((b) => '▪ ' + esc(b)).join('<br>')}</div>`).join('')}</div>`;
  else if (m.kind === 'pdf' || m.kind === 'docx') body = `<div class="list">${(s.sections || []).map((x) => `<div class="item"><b>${esc(x.heading || '')}</b><small>${esc((x.paragraphs || [])[0] || '')}</small></div>`).join('')}</div>`;
  else if (m.kind === 'xlsx') body = `<div style="overflow-x:auto;margin-top:8px"><table><tr>${(s.columns || []).map((c) => `<th>${esc(c)}</th>`).join('')}</tr>${(s.rows || []).slice(0, 30).map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table></div>`;
  else if (m.kind === 'html') body = `<iframe class="site" sandbox="" title="Vorschau"></iframe>`;
  else if (m.kind === 'video') body = `<video src="${m.url}" controls playsinline></video><p>${esc(s.caption || '')}</p><div class="muted">${(s.hashtags || []).map((x) => '#' + esc(x)).join(' ')}</div>`;
  $('view').innerHTML = `<div class="card"><h3>${esc(KINDS[m.kind].label.toUpperCase())} <span>${esc(m.file.name)} · ${Math.max(1, Math.round(m.file.size / 1024))} KB</span></h3><div class="big" style="font-size:24px">${esc(s.title || m.topic)}</div>${body}
    <div class="acts2"><button class="btn ${highlightShare || m.kind === 'video' ? 'hot' : ''}" id="mkShare">${m.kind === 'video' ? 'Teilen → TikTok' : 'Teilen / Sichern'}</button><button class="btn ${highlightShare || m.kind === 'video' ? '' : 'hot'}" id="mkOpen">Öffnen</button>${m.kind === 'video' ? '<button class="btn" id="mkCap">Beschreibung kopieren</button>' : ''}</div>
    ${made.length > 1 ? `<div class="list" style="margin-top:12px">${made.slice(1, 6).map((x, i) => `<a href="#" data-made="${i + 1}"><b>${esc(x.file.name)}</b><small>${esc(KINDS[x.kind].label)} · ${x.created.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</small></a>`).join('')}</div>` : ''}</div>`;
  if (m.kind === 'html') $('view').querySelector('iframe').srcdoc = m.html;
  $('view').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('mkShare').onclick = () => shareFile(m);
  $('mkOpen').onclick = () => window.open(m.url, '_blank');
  const cap = $('mkCap');
  if (cap) cap.onclick = () => navigator.clipboard?.writeText(`${s.caption || ''}\n\n${(s.hashtags || []).map((x) => '#' + x).join(' ')}`).then(() => { cap.textContent = 'Kopiert ✓'; }).catch(() => { cap.textContent = 'Nicht erlaubt'; });
  $('view').querySelectorAll('[data-made]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); lastMade = made[+a.dataset.made]; renderMade(lastMade); }));
}
async function shareFile(m) {
  const data = { files: [m.file], title: m.file.name };
  try {
    if (navigator.canShare && navigator.canShare(data)) { await navigator.share(data); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = m.url; a.download = m.file.name; document.body.appendChild(a); a.click(); a.remove();
}

function remember(user, assistant) {
  history.push({ role: 'user', content: user }, { role: 'assistant', content: assistant || '…' });
  while (history.length > 16) history.shift();
}

$('text').addEventListener('keydown', (e) => { if (e.key === 'Enter') send($('text').value); });
document.querySelectorAll('.chip').forEach((b) => (b.onclick = () => {
  if (b.dataset.fill) { const t = $('text'); t.value = b.dataset.fill; t.focus(); t.setSelectionRange(t.value.length, t.value.length); return; }
  send(b.dataset.cmd);
}));

// ---------------------------------------------------------------- speech in / out
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
$('mic').onclick = () => {
  unlockSpeech();
  if (SR && window.isSecureContext) {
    if (listening && rec) { rec.stop(); return; }
    try {
      stopSpeaking();
      rec = new SR(); rec.lang = 'de-DE'; rec.interimResults = true; rec.continuous = false;
      rec.onresult = (e) => { let t = ''; for (const r of e.results) t += r[0].transcript; $('you').textContent = t; level = 1; if (e.results[e.results.length - 1].isFinal) send(t); };
      rec.onend = () => { listening = false; $('mic').classList.remove('live'); if (uiState === 'listening') setState('sleeping'); };
      rec.onerror = (e) => { listening = false; $('mic').classList.remove('live'); if (e.error === 'not-allowed' || e.error === 'service-not-allowed') dictationHint(); };
      rec.start(); listening = true; $('mic').classList.add('live'); setState('listening');
      return;
    } catch (e) { /* fall back */ }
  }
  dictationHint();
};
function dictationHint() { $('text').focus(); $('reply').textContent = 'Tippe auf das Mikrofon der Tastatur, sprich und dann auf Senden.'; }
let unlocked = false, voice = null;
function unlockSpeech() {
  unlockAudio();
  if (unlocked || !window.speechSynthesis) return;
  unlocked = true;
  const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u);
}
function pickVoice() {
  if (!window.speechSynthesis) return null;
  const vs = speechSynthesis.getVoices().filter((v) => v.lang && v.lang.startsWith('de'));
  const male = ['Markus', 'Yannick', 'Martin', 'Viktor', 'Helmut', 'Daniel'];
  return vs.find((v) => male.some((n) => v.name.includes(n)) && /premium|enhanced|erweitert/i.test(v.name)) || vs.find((v) => male.some((n) => v.name.includes(n))) || vs.find((v) => /premium|enhanced|erweitert/i.test(v.name)) || vs[0] || null;
}
if (window.speechSynthesis) speechSynthesis.onvoiceschanged = () => { voice = pickVoice(); };
let lastWhole = '';
function speak(text, whole) {
  if (!$('speak').checked || !window.speechSynthesis || !text) return;
  if (whole) { if (text === lastWhole) return; lastWhole = text; speechSynthesis.cancel(); }
  const clean = text.replace(/https?:\/\/\S+/g, '').replace(/[*#`_]/g, '').replace(/%/g, ' Prozent').trim();
  if (!clean) return;
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = 'de-DE'; u.voice = voice || pickVoice(); u.rate = 1.03; u.pitch = 0.9;
  u.onboundary = () => { level = 0.8; };
  speechSynthesis.speak(u);
}
function stopSpeaking() { lastWhole = ''; try { speechSynthesis.cancel(); } catch (e) {} }

// ---------------------------------------------------------------- views
let curView = 'core', lastTele = null;
function fileURL(p) { return `/api/file?path=${encodeURIComponent(p)}&t=${encodeURIComponent(token || '')}`; }
function renderView(view, d) {
  curView = view;
  const v = $('view');
  let h = '';
  if (view === 'globe') {
    h = `<div class="card"><h3>WELTLAGE <span>${esc(d.source || '')}</span></h3><div class="big">${esc((d.country || 'Welt').toUpperCase())}</div>` +
      (d.news || []).slice(0, 10).map((n) => `<a class="news" href="${esc(n.url)}" target="_blank"><div class="th" style="${n.image ? `background-image:url('${esc(n.image)}')` : ''}"></div><div><b>${esc(n.title)}</b><div class="muted">${esc(n.source || '')}</div></div></a>`).join('') + '</div>';
  } else if (view === 'markets') {
    const up = (d.changePct || 0) >= 0, an = d.analysis;
    h = `<div class="card"><h3>${esc(d.symbol || '')} <span>${esc(d.name || '')}</span></h3><div class="row"><span class="big">${nf(d.price, d.price > 1000 ? 0 : 2)}</span><span class="muted">${esc(d.currency || '')}</span><b class="${up ? 'up' : 'down'}">${up ? '▲ +' : '▼ '}${nf(d.changePct)} %</b></div><canvas class="chart" id="chart"></canvas>` +
      (an ? `<div class="sig ${an.signal === 'bullisch' ? 'up' : an.signal === 'bärisch' ? 'down' : ''}"><b>${esc(an.signal.toUpperCase())}</b><div>EINSTIEG<b>${nf(an.entry)}</b></div><div>STOP<b>${nf(an.stop)}</b></div><div>ZIEL<b>${nf(an.target)}</b></div></div>` : '') +
      ((d.watch || []).length ? '<div class="list" style="margin-top:10px">' + d.watch.map((w) => `<div class="item"><b>${esc(w.symbol)}</b> <span class="${(w.changePct || 0) >= 0 ? 'up' : 'down'}">${nf(w.changePct)} %</span><small>${esc(w.name || '')} · ${nf(w.price)}</small></div>`).join('') + '</div>' : '') + '</div>';
  } else if (view === 'weather') {
    const c = d.current || {}, dd = d.daily || {};
    h = `<div class="card"><h3>WETTER <span>${esc(d.place || '')}</span></h3><div class="big">${c.temp != null ? Math.round(c.temp) + '°' : '—'}</div><div class="muted">Gefühlt ${c.apparent != null ? Math.round(c.apparent) + '°' : '—'} · Wind ${c.wind != null ? Math.round(c.wind) : '—'} km/h</div>` +
      `<div class="days">${(dd.time || []).slice(0, 7).map((t, i) => `<div>${new Date(t).toLocaleDateString('de-DE', { weekday: 'short' })}<b>${Math.round(dd.max[i])}°</b>${Math.round(dd.min[i])}°</div>`).join('')}</div></div>`;
  } else if (view === 'files') {
    h = `<div class="card"><h3>DATEIEN (MAC) <span>${esc(d.query || '')}</span></h3><div class="list">${d.searching ? '<div class="muted">Suche …</div>' : (d.results || []).slice(0, 40).map((f) => `<div class="item"><b>${esc(f.name)}</b><small>${esc(f.path)}</small></div>`).join('') || '<div class="muted">Keine Treffer</div>'}</div></div>`;
  } else if (view === 'presentation') {
    h = `<div class="card"><h3>PRÄSENTATION</h3><div class="big" style="font-size:28px">${esc(d.title || '')}</div><div class="list">${(d.slides || []).map((s, i) => `<div class="item"><b>${i + 2}. ${esc(s.title || s.quote || '')}</b><small>${esc((s.bullets || []).map((b) => b.text || b).join(' · '))}</small></div>`).join('')}</div>${d.file ? `<a class="btn hot" href="${fileURL(d.file)}">Datei öffnen</a>` : ''}</div>`;
  } else if (view === 'document') {
    const s = d.spec || {};
    h = `<div class="card"><h3>DOKUMENT <span>${esc((d.format || '').toUpperCase())}</span></h3><div class="big" style="font-size:26px">${esc(s.title || '')}</div><div class="list">${(s.sections || []).map((x) => `<div class="item"><b>${esc(x.heading || '')}</b><small>${esc((x.paragraphs || [])[0] || '')}</small></div>`).join('')}</div>${d.file ? `<a class="btn hot" href="${fileURL(d.file)}">Datei öffnen</a>` : ''}</div>`;
  } else if (view === 'data') {
    const sh = (d.sheets || [d])[0] || {};
    h = `<div class="card"><h3>TABELLE <span>${esc(d.title || '')}</span></h3><div style="overflow-x:auto"><table><tr>${(sh.columns || []).map((c) => `<th>${esc(c)}</th>`).join('')}</tr>${(sh.rows || []).slice(0, 40).map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table></div>${d.file ? `<a class="btn hot" href="${fileURL(d.file)}">Excel öffnen</a>` : ''}</div>`;
  } else if (view === 'code') {
    h = `<div class="card"><h3>WEBSITE</h3><div class="muted">${esc(d.path || 'wird gebaut …')}</div>${d.path ? `<a class="btn hot" href="${fileURL(d.path)}" target="_blank">Website ansehen</a>` : ''}</div>`;
  } else if (view === 'video') {
    h = `<div class="card"><h3>VIDEO <span>${d.rendering ? 'RENDERT …' : esc(d.duration ? nf(d.duration, 1) + ' s' : '')}</span></h3><div class="big" style="font-size:26px">${esc(d.title || '')}</div>` +
      (d.file && !d.rendering ? `<video src="${fileURL(d.file)}" controls playsinline></video><a class="btn hot" href="${fileURL(d.file)}" download>Video aufs iPhone laden</a>` : '<div class="muted">Video wird auf dem Mac produziert …</div>') +
      `<p>${esc(d.caption || '')}</p><div class="muted">${(d.hashtags || []).map((x) => '#' + esc(String(x).replace(/^#/, ''))).join(' ')}</div>` +
      (d.file && !d.rendering ? `<button class="btn" id="copyCap">Beschreibung kopieren</button>` : '') + '</div>';
  } else {
    curView = 'core';
    const t = lastTele;
    const mem = Memory.all();
    h = (t ? `<div class="card"><h3>MAC <span>${esc(t.host || '')}</span></h3><div class="row"><div>CPU <b>${t.cpu != null ? Math.round(t.cpu) + ' %' : '—'}</b></div><div>RAM <b>${t.ram ? nf(t.ram.used, 1) + '/' + nf(t.ram.total, 0) + ' GB' : '—'}</b></div></div></div>` : '') +
      `<div class="card"><h3>GEDÄCHTNIS (IPHONE) <span>${mem.length}</span></h3><div class="list">${mem.slice(-8).reverse().map((x) => `<div class="item">${esc(x.text)}<small>${esc(x.category || '')}</small></div>`).join('') || '<div class="muted">Sag z. B. „Merk dir, dass ich Kaffee schwarz trinke.“</div>'}</div></div>`;
  }
  v.innerHTML = h;
  if (view === 'markets') drawChart($('chart'), (d.candles || []).map((c) => c.c));
  const cc = $('copyCap');
  if (cc) cc.onclick = () => { navigator.clipboard?.writeText(`${d.caption || ''}\n\n${(d.hashtags || []).map((x) => '#' + String(x).replace(/^#/, '')).join(' ')}`).then(() => { cc.textContent = 'Kopiert ✓'; }).catch(() => { cc.textContent = 'Kopieren nicht erlaubt'; }); };
}
function drawChart(cv, vals) {
  if (!cv || vals.length < 2) return;
  const dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  cv.width = w * dpr; cv.height = h * dpr;
  const x = cv.getContext('2d'); x.scale(dpr, dpr);
  const mn = Math.min(...vals), mx = Math.max(...vals), sp = (mx - mn) || 1;
  const X = (i) => (i / (vals.length - 1)) * w, Y = (v) => 6 + (1 - (v - mn) / sp) * (h - 12);
  const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(255,106,26,.35)'); g.addColorStop(1, 'rgba(255,106,26,0)');
  x.beginPath(); vals.forEach((v, i) => (i ? x.lineTo(X(i), Y(v)) : x.moveTo(X(i), Y(v)))); x.lineTo(w, h); x.lineTo(0, h); x.closePath(); x.fillStyle = g; x.fill();
  x.beginPath(); vals.forEach((v, i) => (i ? x.lineTo(X(i), Y(v)) : x.moveTo(X(i), Y(v)))); x.strokeStyle = '#ff6a1a'; x.lineWidth = 2; x.stroke();
}

// ---------------------------------------------------------------- core animation
(function core() {
  const cv = $('core'), x = cv.getContext('2d'), W = cv.width, c = W / 2;
  let t = 0;
  function frame() {
    t += 0.016;
    const speed = uiState === 'thinking' ? 3 : (uiState === 'speaking' || listening) ? 1.6 : 0.6;
    level *= 0.92;
    x.clearRect(0, 0, W, W);
    const glow = x.createRadialGradient(c, c, 10, c, c, W / 2);
    glow.addColorStop(0, 'rgba(255,106,26,.35)'); glow.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = glow; x.fillRect(0, 0, W, W);
    [[150, 6, 1.2, '#ff6a1a'], [125, 2, -0.8, '#ffb066'], [175, 2, 0.5, 'rgba(255,106,26,.5)']].forEach(([r, lw, sp, col], k) => {
      x.strokeStyle = col; x.lineWidth = lw;
      for (let s = 0; s < (k === 1 ? 1 : 3); s++) { const a = t * sp * speed + s * 2.1; x.beginPath(); x.arc(c, c, r, a, a + (k === 1 ? 4.5 : 1.3)); x.stroke(); }
    });
    for (let i = 0; i < 60; i++) { const a = i / 60 * Math.PI * 2, r1 = 192, r2 = i % 5 ? 198 : 206; x.strokeStyle = 'rgba(255,106,26,.45)'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1); x.lineTo(c + Math.cos(a) * r2, c + Math.sin(a) * r2); x.stroke(); }
    const pr = 46 + Math.sin(t * 3) * 3 + level * 30;
    x.fillStyle = brain.ready ? '#ff6a1a' : '#7a2e0c'; x.shadowColor = '#ff6a1a'; x.shadowBlur = brain.ready ? 40 : 10; x.beginPath(); x.arc(c, c, pr, 0, 7); x.fill();
    x.shadowBlur = 0; x.fillStyle = brain.ready ? '#ffd6aa' : '#3a1a0a'; x.beginPath(); x.arc(c, c, pr * 0.5, 0, 7); x.fill();
    requestAnimationFrame(frame);
  }
  frame();
})();

// ---------------------------------------------------------------- settings
function renderSettings() {
  $('models').innerHTML = Object.entries(MODELS).map(([k, m]) => `<label class="opt"><input type="radio" name="model" value="${k}" ${k === modelChoice ? 'checked' : ''}> ${esc(m.label)}</label>`).join('');
  document.querySelectorAll('input[name=model]').forEach((r) => (r.onchange = () => { modelChoice = r.value; store.set('jarvisModel', modelChoice); renderOnboarding(); }));
  document.querySelectorAll('#mode button').forEach((b) => { b.classList.toggle('on', b.dataset.m === mode); b.onclick = () => { mode = b.dataset.m; store.set('jarvisMode', mode); renderSettings(); }; });
}
$('gear').onclick = () => { renderSettings(); setBrainChip(); $('settings').hidden = false; };
$('closeSettings').onclick = () => { $('settings').hidden = true; };
$('loadBrain').onclick = () => { unlockSpeech(); loadBrain(); };

// ---------------------------------------------------------------- start
if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => {});
renderView('core', {});
setBrainChip();
setMac(false);
// Mac link only exists when the page is served by the Mac app (/api/ping answers with JSON)
fetch('api/ping', { headers: token ? { Authorization: 'Bearer ' + token } : {} })
  .then((r) => { macHost = (r.headers.get('content-type') || '').includes('json'); })
  .catch(() => { macHost = false; })
  .finally(() => { setMac(false); connectMac(); });
if (store.get('jarvisBrainLoaded', '0') === '1' && params.get('engine') !== 'mock') { /* reload from cache needs a tap on iOS (audio unlock) – shown in onboarding */ }
window.JARVIS_MOBILE = { send, route, brain, made: () => made };
