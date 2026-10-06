// JARVIS on the iPhone – generators that run entirely on the phone:
// PowerPoint, PDF, Word, Excel, websites, TikTok videos and stock quotes.
// Content comes from the on-phone language model; files are built in the browser.

import { analyze } from './brain.js';

// ------------------------------------------------------------------ helpers
const scripts = {};
function loadScript(src) {
  if (!scripts[src]) {
    scripts[src] = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error(`${src} konnte nicht geladen werden`));
      document.head.appendChild(s);
    });
  }
  return scripts[src];
}
const xml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const html = xml;
export const slug = (s) => (String(s || 'jarvis').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'jarvis');
const clean = (s) => String(s || '').replace(/\*\*|__|`/g, '').replace(/^["„“]+|["“”]+$/g, '').trim();
const today = () => new Date().toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });

export const KINDS = {
  pptx: { label: 'Präsentation', ext: 'pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  pdf: { label: 'PDF', ext: 'pdf', mime: 'application/pdf' },
  docx: { label: 'Word-Dokument', ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  xlsx: { label: 'Excel-Tabelle', ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  html: { label: 'Website', ext: 'html', mime: 'text/html' },
  video: { label: 'TikTok-Video', ext: 'mp4', mime: 'video/mp4' },
};

// ------------------------------------------------------------------ prompts + parsers
const PROMPTS = {
  pptx: (t) => `Schreibe den Inhalt einer Präsentation zum Thema „${t}“ auf Deutsch.
Antworte NUR in genau diesem Format, ohne Einleitung:
TITEL: <Titel>
UNTERTITEL: <ein kurzer Satz>
# <Titel Folie 1>
- <Stichpunkt>
- <Stichpunkt>
- <Stichpunkt>
# <Titel Folie 2>
- <Stichpunkt>
…
Genau 6 Folien mit je 3 bis 4 kurzen, konkreten Stichpunkten.`,
  doc: (t) => `Schreibe ein Dokument zum Thema „${t}“ auf Deutsch.
Antworte NUR in genau diesem Format, ohne Einleitung:
TITEL: <Titel>
# <Überschrift Abschnitt 1>
<Absatz mit 3 bis 5 Sätzen>
# <Überschrift Abschnitt 2>
<Absatz>
…
4 bis 6 Abschnitte, sachlich und konkret.`,
  xlsx: (t) => `Erstelle eine Tabelle zum Thema „${t}“ auf Deutsch.
Antworte NUR in genau diesem Format, ohne Einleitung:
TITEL: <Titel>
<Spalte 1>;<Spalte 2>;<Spalte 3>
<Wert>;<Wert>;<Wert>
…
Erste Zeile sind die Spaltennamen, danach 8 bis 15 Zeilen. Trenne mit Semikolon. Zahlen ohne Einheit, mit Punkt als Dezimaltrenner.`,
  html: (t) => `Schreibe die Texte für eine moderne Website zum Thema „${t}“ auf Deutsch.
Antworte NUR in genau diesem Format, ohne Einleitung:
TITEL: <Name oder Titel der Seite>
UNTERTITEL: <ein starker Satz für den Kopfbereich>
BUTTON: <Text für den Hauptknopf>
# <Abschnittsüberschrift>
<2 bis 3 Sätze>
# <Abschnittsüberschrift>
<2 bis 3 Sätze>
…
4 bis 6 Abschnitte.`,
  video: (t) => `Schreibe ein kurzes TikTok-Video zum Thema „${t}“ auf Deutsch.
Antworte NUR in genau diesem Format, ohne Einleitung:
TITEL: <Titel>
HOOK: <packender erster Satz, höchstens 8 Wörter>
# <Szene 1, höchstens 12 Wörter>
# <Szene 2, höchstens 12 Wörter>
…
CAPTION: <Beschreibung für TikTok, 1 bis 2 Sätze>
HASHTAGS: #<tag> #<tag> #<tag> #<tag>
5 bis 7 Szenen.`,
};

function fields(text) {
  const f = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*\**\s*(TITEL|UNTERTITEL|BUTTON|HOOK|CAPTION|HASHTAGS)\s*\**\s*:\s*(.+)$/i);
    if (m) f[m[1].toUpperCase()] = clean(m[2]);
  }
  return f;
}
const isHeading = (l) => /^\s*(#{1,4}\s+|folie\s*\d+\s*[:.-]|szene\s*\d+\s*[:.-]|abschnitt\s*\d+\s*[:.-]|\*\*[^*]+\*\*\s*$)/i.test(l);
const headingText = (l) => clean(l.replace(/^\s*#{1,4}\s+/, '').replace(/^\s*(folie|szene|abschnitt)\s*\d+\s*[:.-]\s*/i, ''));
const isBullet = (l) => /^\s*([-*•–]|\d+[.)])\s+/.test(l);
const bulletText = (l) => clean(l.replace(/^\s*([-*•–]|\d+[.)])\s+/, ''));
const isField = (l) => /^\s*\**\s*(TITEL|UNTERTITEL|BUTTON|HOOK|CAPTION|HASHTAGS)\s*\**\s*:/i.test(l);

/** Generic "# heading / body" parser used for slides, documents, websites and video scenes. */
export function parseSections(text) {
  const out = [];
  let cur = null;
  for (const raw of text.split('\n')) {
    const l = raw.trim();
    if (!l || isField(l)) continue;
    if (isHeading(l)) { cur = { title: headingText(l), bullets: [], body: [] }; out.push(cur); continue; }
    if (!cur) { cur = { title: '', bullets: [], body: [] }; out.push(cur); }
    if (isBullet(l)) cur.bullets.push(bulletText(l)); else cur.body.push(clean(l));
  }
  return out.filter((s) => s.title || s.bullets.length || s.body.length);
}

export function parsePresentation(text, topic) {
  const f = fields(text);
  let slides = parseSections(text).map((s) => ({ title: s.title || 'Überblick', bullets: (s.bullets.length ? s.bullets : s.body.flatMap((b) => b.split(/(?<=[.!?])\s+/))).filter(Boolean).slice(0, 6) }));
  slides = slides.filter((s) => s.bullets.length || s.title);
  if (!slides.length) slides = [{ title: topic, bullets: text.split(/(?<=[.!?])\s+/).map(clean).filter(Boolean).slice(0, 5) }];
  return { title: f.TITEL || cap1(topic), subtitle: f.UNTERTITEL || '', slides: slides.slice(0, 12) };
}
export function parseDocument(text, topic) {
  const f = fields(text);
  let sections = parseSections(text).map((s) => ({ heading: s.title, paragraphs: [...s.body, ...s.bullets.map((b) => '• ' + b)] }));
  if (!sections.length) sections = [{ heading: '', paragraphs: [text.trim()] }];
  return { title: f.TITEL || cap1(topic), sections };
}
export function parseTable(text, topic) {
  const f = fields(text);
  const rows = text.split('\n').map((l) => l.trim()).filter((l) => l && !isField(l) && /[;|\t]/.test(l) && !/^[-|:; ]+$/.test(l))
    .map((l) => l.replace(/^\||\|$/g, '').split(/\s*[;|\t]\s*/).map(clean));
  if (!rows.length) return { title: f.TITEL || cap1(topic), columns: ['Inhalt'], rows: text.split('\n').filter(Boolean).map((l) => [clean(l)]) };
  const width = rows[0].length;
  const body = rows.slice(1).map((r) => r.slice(0, width).concat(Array(Math.max(0, width - r.length)).fill('')))
    .map((r) => r.map((c) => (/^-?\d+(?:[.,]\d+)?$/.test(c.replace(/\s/g, '')) ? Number(c.replace(/\s/g, '').replace(',', '.')) : c)));
  return { title: f.TITEL || cap1(topic), columns: rows[0], rows: body };
}
export function parseWebsite(text, topic) {
  const f = fields(text);
  const sections = parseSections(text).map((s) => ({ heading: s.title, text: [...s.body, ...s.bullets].join(' ') })).filter((s) => s.heading || s.text);
  return { title: f.TITEL || cap1(topic), subtitle: f.UNTERTITEL || '', button: f.BUTTON || 'Mehr erfahren', sections: sections.length ? sections : [{ heading: cap1(topic), text: text.trim() }] };
}
export function parseVideo(text, topic) {
  const f = fields(text);
  let scenes = parseSections(text).map((s) => s.title || s.body.join(' ') || s.bullets.join(' ')).filter(Boolean);
  if (scenes.length < 2) scenes = text.split('\n').map((l) => clean(l.replace(/^[-*#\d.)\s]+/, ''))).filter((l) => l && !isField(l));
  const tags = (f.HASHTAGS || '').match(/#?[\p{L}\d_]+/gu) || [];
  return { title: f.TITEL || cap1(topic), hook: f.HOOK || cap1(topic), scenes: scenes.slice(0, 8), caption: f.CAPTION || f.TITEL || cap1(topic), hashtags: (tags.length ? tags : ['fyp', 'wissen', slug(topic).split('-')[0]]).map((t) => t.replace(/^#/, '')).slice(0, 6) };
}
const cap1 = (s) => { s = String(s || '').trim(); return s.charAt(0).toUpperCase() + s.slice(1); };

// ------------------------------------------------------------------ builders
const C = { bg: '0B0B0C', panel: '161210', ember: 'FF6A1A', bone: 'F2EDE6', ash: '9A918A' };

export async function buildPptx(spec) {
  await loadScript('pptxgen.bundle.js');
  const p = new window.PptxGenJS();
  p.layout = 'LAYOUT_WIDE'; p.title = spec.title; p.author = 'JARVIS';
  const font = 'Helvetica Neue';
  const t = p.addSlide(); t.background = { color: C.bg };
  t.addShape(p.ShapeType.rect, { x: 0.7, y: 2.2, w: 0.12, h: 2.3, fill: { color: C.ember }, line: { color: C.ember } });
  t.addText(spec.title, { x: 1.1, y: 2.1, w: 11, h: 1.5, fontFace: font, fontSize: 44, bold: true, color: C.bone, valign: 'bottom', fit: 'shrink' });
  if (spec.subtitle) t.addText(spec.subtitle, { x: 1.1, y: 3.6, w: 11, h: 0.9, fontFace: font, fontSize: 20, color: C.ash, valign: 'top' });
  t.addText(today(), { x: 1.1, y: 6.6, w: 6, h: 0.4, fontFace: font, fontSize: 12, color: C.ember });
  spec.slides.forEach((s, i) => {
    const sl = p.addSlide(); sl.background = { color: C.bg };
    sl.addText(String(i + 1).padStart(2, '0'), { x: 0.7, y: 0.45, w: 1, h: 0.5, fontFace: font, fontSize: 14, bold: true, color: C.ember });
    sl.addText(s.title, { x: 0.7, y: 0.85, w: 11.9, h: 1.0, fontFace: font, fontSize: 32, bold: true, color: C.bone, fit: 'shrink' });
    sl.addShape(p.ShapeType.rect, { x: 0.7, y: 1.9, w: 1.4, h: 0.06, fill: { color: C.ember }, line: { color: C.ember } });
    if (s.bullets.length) {
      sl.addText(s.bullets.map((b) => ({ text: b, options: { bullet: { code: '25A0', color: C.ember }, paraSpaceAfter: 14 } })),
        { x: 0.7, y: 2.3, w: 11.9, h: 4.6, fontFace: font, fontSize: 24, color: C.bone, valign: 'top', fit: 'shrink' });
    }
    sl.addText(`${spec.title}  ·  ${i + 2}`, { x: 0.7, y: 7.0, w: 11.9, h: 0.3, fontFace: font, fontSize: 10, color: C.ash, align: 'right' });
  });
  const e = p.addSlide(); e.background = { color: C.bg };
  e.addText('Danke.', { x: 0.7, y: 2.8, w: 11.9, h: 1.2, fontFace: font, fontSize: 48, bold: true, color: C.bone, align: 'center' });
  e.addShape(p.ShapeType.rect, { x: 6.0, y: 4.1, w: 1.33, h: 0.06, fill: { color: C.ember }, line: { color: C.ember } });
  return p.write({ outputType: 'blob' });
}

export async function buildPdf(spec) {
  await loadScript('jspdf.umd.min.js');
  const { jsPDF } = window.jspdf;
  const d = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, M = 22, maxW = W - 2 * M;
  let y = 30;
  d.setFillColor(255, 106, 26); d.rect(M, 18, 18, 1.4, 'F');
  d.setFont('helvetica', 'bold'); d.setFontSize(24); d.setTextColor(20, 20, 20);
  for (const line of d.splitTextToSize(spec.title, maxW)) { d.text(line, M, y); y += 10; }
  d.setFont('helvetica', 'normal'); d.setFontSize(10); d.setTextColor(120, 120, 120); d.text(`${today()} · erstellt von JARVIS`, M, y); y += 12;
  const need = (h) => { if (y + h > 297 - 20) { d.addPage(); y = 24; } };
  for (const s of spec.sections) {
    if (s.heading) { need(14); d.setFont('helvetica', 'bold'); d.setFontSize(14); d.setTextColor(255, 106, 26); for (const l of d.splitTextToSize(s.heading, maxW)) { d.text(l, M, y); y += 7; } y += 1; }
    d.setFont('helvetica', 'normal'); d.setFontSize(11); d.setTextColor(30, 30, 30);
    for (const p of s.paragraphs) { for (const l of d.splitTextToSize(p, maxW)) { need(6); d.text(l, M, y); y += 5.6; } y += 3; }
    y += 3;
  }
  const n = d.getNumberOfPages();
  for (let i = 1; i <= n; i++) { d.setPage(i); d.setFontSize(9); d.setTextColor(150, 150, 150); d.text(`${i} / ${n}`, W - M, 297 - 10, { align: 'right' }); }
  return d.output('blob');
}

async function zip(files, mime) {
  await loadScript('jszip.min.js');
  const z = new window.JSZip();
  for (const [name, content] of Object.entries(files)) z.file(name, content);
  return z.generateAsync({ type: 'blob', mimeType: mime, compression: 'DEFLATE' });
}
const XMLH = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

export function docxFiles(spec) {
  const para = (text, style) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`;
  const body = [para(spec.title, 'Title'), para(`${today()} · erstellt von JARVIS`, 'Subtitle')]
    .concat(spec.sections.flatMap((s) => [s.heading ? para(s.heading, 'Heading1') : '', ...s.paragraphs.map((p) => para(p))])).join('');
  return {
    '[Content_Types].xml': XMLH + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    '_rels/.rels': XMLH + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/_rels/document.xml.rels': XMLH + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'word/styles.xml': XMLH + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="de-DE"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="52"/><w:color w:val="141414"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:after="360"/></w:pPr><w:rPr><w:color w:val="808080"/><w:sz w:val="20"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="320" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/><w:color w:val="E8590C"/></w:rPr></w:style>' +
      '</w:styles>',
    'word/document.xml': XMLH + `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1418" w:right="1418" w:bottom="1134" w:left="1418" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>`,
  };
}
export const buildDocx = (spec) => zip(docxFiles(spec), KINDS.docx.mime);

function colName(i) { let s = ''; i += 1; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
export function xlsxFiles(spec) {
  const all = [spec.columns, ...spec.rows];
  const cell = (v, r, c) => {
    const ref = colName(c) + (r + 1);
    if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"${r === 0 ? ' s="1"' : ''}><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${r === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
  };
  const widths = spec.columns.map((_, c) => Math.min(60, Math.max(10, ...all.map((r) => String(r[c] ?? '').length + 2))));
  const sheet = XMLH + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` +
    `<sheetData>${all.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => cell(v, ri, ci)).join('')}</row>`).join('')}</sheetData>` +
    (all.length > 1 ? `<autoFilter ref="A1:${colName(spec.columns.length - 1)}${all.length}"/>` : '') + '</worksheet>';
  const name = xml(String(spec.title || 'Tabelle').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31)) || 'Tabelle';
  return {
    '[Content_Types].xml': XMLH + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    '_rels/.rels': XMLH + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': XMLH + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets>${all.length > 1 ? `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${name.replace(/'/g, "''")}'!$A$1:$${colName(spec.columns.length - 1)}$${all.length}</definedName></definedNames>` : ''}</workbook>`,
    'xl/_rels/workbook.xml.rels': XMLH + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'xl/styles.xml': XMLH + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8590C"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
    'xl/worksheets/sheet1.xml': sheet,
  };
}
export const buildXlsx = (spec) => zip(xlsxFiles(spec), KINDS.xlsx.mime);

export function websiteHTML(s) {
  const accent = '#ff6a1a';
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${html(s.title)}</title><meta name="description" content="${html(s.subtitle)}">
<style>
:root{--bg:#0b0b0c;--panel:#141110;--text:#f2ede6;--muted:#a59c94;--accent:${accent}}
*{box-sizing:border-box;margin:0}body{background:var(--bg);color:var(--text);font:17px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
a{color:inherit}.wrap{max-width:1080px;margin:0 auto;padding:0 24px}
nav{position:sticky;top:0;background:rgba(11,11,12,.85);backdrop-filter:blur(10px);border-bottom:1px solid #2a211c;z-index:2}
nav .wrap{display:flex;justify-content:space-between;align-items:center;height:64px}nav b{letter-spacing:.08em}
nav a.cta{background:var(--accent);color:#000;text-decoration:none;padding:8px 16px;font-weight:600;border-radius:999px;font-size:15px;white-space:nowrap}
@media(max-width:560px){nav a.cta{display:none}header{padding:80px 0 64px}}
header{padding:120px 0 96px;background:radial-gradient(60% 80% at 80% 0%,rgba(255,106,26,.22),transparent)}
header h1{font-size:clamp(40px,7vw,76px);line-height:1.04;letter-spacing:-.02em;max-width:14ch}
header p{color:var(--muted);font-size:clamp(18px,2.4vw,22px);max-width:42ch;margin-top:20px}
header a.cta{display:inline-block;margin-top:36px;background:var(--accent);color:#000;text-decoration:none;padding:14px 28px;font-weight:700;border-radius:999px}
section{padding:72px 0;border-top:1px solid #1f1916}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}
.card{background:var(--panel);border:1px solid #2a211c;border-radius:16px;padding:28px}
.card span{color:var(--accent);font-weight:700;font-size:14px;letter-spacing:.1em}
.card h2{font-size:24px;margin:10px 0 10px;line-height:1.25}.card p{color:var(--muted)}
footer{padding:48px 0;color:var(--muted);font-size:14px;border-top:1px solid #1f1916}
</style></head><body>
<nav><div class="wrap"><b>${html(s.title.toUpperCase())}</b><a class="cta" href="#mehr">${html(s.button)}</a></div></nav>
<header><div class="wrap"><h1>${html(s.title)}</h1><p>${html(s.subtitle)}</p><a class="cta" href="#mehr">${html(s.button)}</a></div></header>
<section id="mehr"><div class="wrap grid">
${s.sections.map((x, i) => `<article class="card"><span>${String(i + 1).padStart(2, '0')}</span><h2>${html(x.heading)}</h2><p>${html(x.text)}</p></article>`).join('\n')}
</div></section>
<footer><div class="wrap">© ${new Date().getFullYear()} ${html(s.title)}</div></footer>
</body></html>`;
}

// ------------------------------------------------------------------ TikTok video (canvas + MediaRecorder + WebAudio beat)
export function videoMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const m of ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) {}
  }
  return null;
}
function wrapLines(ctx, text, maxW) {
  const words = String(text).split(/\s+/); const lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur);
  return lines;
}
export async function buildVideo(spec, { onProgress = () => {}, sceneSeconds = 2.8 } = {}) {
  const mime = videoMime();
  if (!mime) throw new Error('Dieser Browser kann keine Videos aufnehmen');
  const W = 720, H = 1280, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const x = cv.getContext('2d');
  const scenes = [spec.hook, ...spec.scenes];
  const total = scenes.length * sceneSeconds + 1.2;
  // audio: simple beat so the clip isn't silent (TikTok lets you swap in a trending sound)
  // iOS only starts audio inside a tap, so the context is created early by unlockAudio()
  const ac = sharedAudio || unlockAudio();
  if (ac && ac.state !== 'running') { try { await Promise.race([ac.resume(), new Promise((r) => setTimeout(r, 600))]); } catch (e) {} }
  const withAudio = !!ac && ac.state === 'running';
  if (!withAudio) return recordFrames(null);
  const dest = ac.createMediaStreamDestination();
  const master = ac.createGain(); master.gain.value = 0.5; master.connect(dest);
  const t0 = ac.currentTime + 0.05, bpm = 112, beat = 60 / bpm;
  const chords = [[220, 277.2, 329.6], [196, 246.9, 293.7], [174.6, 220, 261.6], [196, 246.9, 293.7]];
  for (let i = 0; i * beat < total; i++) {
    const t = t0 + i * beat;
    const k = ac.createOscillator(), kg = ac.createGain(); k.frequency.setValueAtTime(140, t); k.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    kg.gain.setValueAtTime(0.9, t); kg.gain.exponentialRampToValueAtTime(0.001, t + 0.25); k.connect(kg).connect(master); k.start(t); k.stop(t + 0.3);
    const h = ac.createOscillator(), hg = ac.createGain(); h.type = 'square'; h.frequency.value = 6000; hg.gain.setValueAtTime(0.03, t + beat / 2); hg.gain.exponentialRampToValueAtTime(0.0001, t + beat / 2 + 0.05);
    h.connect(hg).connect(master); h.start(t + beat / 2); h.stop(t + beat / 2 + 0.06);
    if (i % 4 === 0) for (const f of chords[(i / 4) % 4]) { const o = ac.createOscillator(), g = ac.createGain(); o.type = 'triangle'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.06, t + 0.3); g.gain.linearRampToValueAtTime(0.0001, t + beat * 4); o.connect(g).connect(master); o.start(t); o.stop(t + beat * 4 + 0.1); }
  }
  return recordFrames(dest);
  async function recordFrames(dest) {
  const stream = new MediaStream([...cv.captureStream(30).getVideoTracks(), ...(dest ? dest.stream.getAudioTracks() : [])]);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
  const chunks = []; rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const done = new Promise((r) => (rec.onstop = r));
  const draw = (t) => {
    const i = Math.min(scenes.length - 1, Math.floor(t / sceneSeconds)), local = t - i * sceneSeconds, a = Math.min(1, local / 0.35);
    const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#0b0b0c'); g.addColorStop(1, i % 2 ? '#2a1206' : '#1a0a04'); x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.save(); x.globalAlpha = 0.18; x.strokeStyle = '#ff6a1a'; x.lineWidth = 3;
    for (let r = 0; r < 3; r++) { x.beginPath(); x.arc(W / 2, H * 0.22, 120 + r * 50, t * (0.6 + r * 0.3), t * (0.6 + r * 0.3) + 2.2); x.stroke(); }
    x.restore();
    x.fillStyle = '#ff6a1a'; x.font = '700 28px Helvetica, Arial, sans-serif'; x.textAlign = 'left';
    x.fillText(i === 0 ? 'JARVIS' : `${i} / ${scenes.length - 1}`, 56, 110);
    x.save(); x.globalAlpha = a; x.translate(0, (1 - a) * 40);
    x.fillStyle = '#f2ede6'; x.font = `800 ${i === 0 ? 72 : 60}px Helvetica, Arial, sans-serif`; x.textAlign = 'center';
    const lines = wrapLines(x, scenes[i], W - 120), lh = i === 0 ? 86 : 74, y0 = H / 2 - (lines.length - 1) * lh / 2;
    lines.forEach((l, k) => x.fillText(l, W / 2, y0 + k * lh));
    x.restore();
    x.fillStyle = '#2a211c'; x.fillRect(56, H - 120, W - 112, 8); x.fillStyle = '#ff6a1a'; x.fillRect(56, H - 120, (W - 112) * Math.min(1, t / total), 8);
    x.fillStyle = '#a59c94'; x.font = '500 26px Helvetica, Arial, sans-serif'; x.textAlign = 'center'; x.fillText(spec.title.slice(0, 40), W / 2, H - 160);
  };
  draw(0);
  rec.start(250);
  const start = performance.now();
  await new Promise((resolve) => {
    const tick = () => {
      const t = (performance.now() - start) / 1000;
      draw(Math.min(t, total)); onProgress(Math.min(1, t / total));
      if (t >= total) resolve(); else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  rec.stop(); await done;
  stream.getTracks().forEach((t) => t.stop());
  if (dest) try { master.disconnect(); } catch (e) {}
  const type = mime.split(';')[0];
  return { blob: new Blob(chunks, { type }), ext: type === 'video/mp4' ? 'mp4' : 'webm', duration: total, audio: !!dest };
  }
}
let sharedAudio = null;
/** Call inside a tap/click: creates and unlocks the AudioContext used for the video soundtrack. */
export function unlockAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!sharedAudio) sharedAudio = new AC();
    if (sharedAudio.state !== 'running') sharedAudio.resume().catch(() => {});
    return sharedAudio;
  } catch (e) { return null; }
}

// ------------------------------------------------------------------ stocks (Yahoo Finance, directly from the phone)
export const STOCKS = { dax: '^GDAXI', 'mdax': '^MDAXI', 'tecdax': '^TECDAX', 'nasdaq': '^IXIC', 'dow jones': '^DJI', 'dow': '^DJI', 's&p': '^GSPC', 's&p 500': '^GSPC', 'euro stoxx': '^STOXX50E',
  apple: 'AAPL', tesla: 'TSLA', nvidia: 'NVDA', microsoft: 'MSFT', amazon: 'AMZN', google: 'GOOGL', alphabet: 'GOOGL', meta: 'META', netflix: 'NFLX', amd: 'AMD', intel: 'INTC', palantir: 'PLTR',
  sap: 'SAP.DE', siemens: 'SIE.DE', 'siemens energy': 'ENR.DE', allianz: 'ALV.DE', bmw: 'BMW.DE', mercedes: 'MBG.DE', volkswagen: 'VOW3.DE', vw: 'VOW3.DE', rheinmetall: 'RHM.DE', 'deutsche bank': 'DBK.DE', telekom: 'DTE.DE', adidas: 'ADS.DE', bayer: 'BAYN.DE', basf: 'BAS.DE', porsche: 'P911.DE', lufthansa: 'LHA.DE',
  gold: 'GC=F', goldpreis: 'GC=F', silber: 'SI=F', silberpreis: 'SI=F', öl: 'CL=F', ölpreis: 'CL=F', 'brent': 'BZ=F', euro: 'EURUSD=X' };
export function stockSymbol(text) {
  const s = ' ' + text.toLowerCase() + ' ';
  const k = Object.keys(STOCKS).sort((a, b) => b.length - a.length).find((n) => s.includes(' ' + n + ' ') || s.includes(' ' + n + '-') || s.includes(' ' + n + '?') || s.includes(' ' + n + 's '));
  if (k) return { symbol: STOCKS[k], name: k.replace(/\b\w/g, (c) => c.toUpperCase()) };
  const t = text.match(/\b([A-Z]{2,5}(?:\.[A-Z]{1,2})?)\b/);
  return t ? { symbol: t[1], name: t[1] } : null;
}
export async function stock(symbol, name, withAnalysis) {
  let j = null, err = null;
  for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
    try {
      const r = await fetch(`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d`);
      if (r.ok) { j = await r.json(); break; }
      err = new Error(`HTTP ${r.status}`);
    } catch (e) { err = e; }
  }
  const res = j?.chart?.result?.[0];
  if (!res) throw new Error('Aktienkurse sind vom iPhone aus gerade nicht abrufbar (der Anbieter blockiert die Anfrage). Krypto funktioniert weiterhin.' + (err ? '' : ''));
  const q = res.indicators.quote[0];
  const k = res.timestamp.map((t, i) => ({ t: t * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] })).filter((x) => x.c != null && x.h != null && x.l != null);
  const last = k[k.length - 1], prev = k[k.length - 2] || last, meta = res.meta || {};
  const price = meta.regularMarketPrice ?? last.c, base = meta.chartPreviousClose && k.length < 3 ? meta.chartPreviousClose : prev.c;
  const changePct = (price / base - 1) * 100;
  const an = analyze(k);
  const cur = meta.currency || '';
  const f = (v) => v.toLocaleString('de-DE', { maximumFractionDigits: v > 1000 ? 0 : 2 });
  let say = `${name} steht bei ${f(price)}${cur === 'EUR' ? ' Euro' : cur === 'USD' ? ' Dollar' : ' Punkten'}, ${changePct >= 0 ? 'plus' : 'minus'} ${Math.abs(changePct).toFixed(1).replace('.', ',')} Prozent.`;
  if (withAnalysis) say = `${name}: Signal ${an.signal}. ${an.reasons.slice(0, 3).join(', ')}. ` + (an.signal === 'bullisch' ? `Mögliches Setup: Einstieg um ${f(an.entry)}, Stop bei ${f(an.stop)}, Ziel ${f(an.target)}.` : an.signal === 'bärisch' ? `Eher meiden. Stop bei ${f(an.stop)}, Ziel nach unten ${f(an.target)}.` : `Abwarten: Unterstützung ${f(an.support)}, Widerstand ${f(an.resistance)}.`);
  return { say, view: 'markets', data: { symbol, name, currency: cur, price, changePct, candles: k.slice(-120).map((x) => ({ c: x.c })), analysis: an } };
}

// ------------------------------------------------------------------ orchestration
/**
 * Generates a file on the phone.
 * kind: pptx | pdf | docx | xlsx | html | video
 * brain: object with chat(messages, {onDelta, maxTokens})
 */
export async function generate(kind, topic, brain, { onStatus = () => {}, onText = () => {} } = {}) {
  if (!brain || !brain.ready) throw new Error('Dafür brauche ich das Gehirn – bitte zuerst oben „Jetzt laden“ tippen.');
  const promptKind = kind === 'pdf' || kind === 'docx' ? 'doc' : kind;
  onStatus('Schreibe Inhalt …');
  const text = await brain.chat([
    { role: 'system', content: 'Du bist JARVIS. Halte dich exakt an das verlangte Format. Kein Markdown außer # und -. /no_think' },
    { role: 'user', content: PROMPTS[promptKind](topic) + ' /no_think' },
  ], { maxTokens: kind === 'video' ? 450 : 1100, onDelta: onText });
  const name = slug(topic);
  onStatus('Baue Datei …');
  switch (kind) {
    case 'pptx': { const spec = parsePresentation(text, topic); const blob = await buildPptx(spec); return { spec, file: new File([blob], `${name}.pptx`, { type: KINDS.pptx.mime }), say: `Die Präsentation „${spec.title}“ ist fertig: ${spec.slides.length + 2} Folien.` }; }
    case 'pdf': { const spec = parseDocument(text, topic); const blob = await buildPdf(spec); return { spec, file: new File([blob], `${name}.pdf`, { type: KINDS.pdf.mime }), say: `Das PDF „${spec.title}“ ist fertig.` }; }
    case 'docx': { const spec = parseDocument(text, topic); const blob = await buildDocx(spec); return { spec, file: new File([blob], `${name}.docx`, { type: KINDS.docx.mime }), say: `Das Word-Dokument „${spec.title}“ ist fertig.` }; }
    case 'xlsx': { const spec = parseTable(text, topic); const blob = await buildXlsx(spec); return { spec, file: new File([blob], `${name}.xlsx`, { type: KINDS.xlsx.mime }), say: `Die Tabelle „${spec.title}“ ist fertig: ${spec.rows.length} Zeilen.` }; }
    case 'html': { const spec = parseWebsite(text, topic); const page = websiteHTML(spec); return { spec, html: page, file: new File([page], `${name}.html`, { type: 'text/html' }), say: `Die Website „${spec.title}“ steht.` }; }
    case 'video': {
      const spec = parseVideo(text, topic);
      onStatus('Nehme Video auf …');
      const v = await buildVideo(spec, { onProgress: (p) => onStatus(`Nehme Video auf … ${Math.round(p * 100)} %`) });
      return { spec, file: new File([v.blob], `${name}.${v.ext}`, { type: v.blob.type }), duration: v.duration, say: `Das TikTok-Video ist fertig, ${Math.round(v.duration)} Sekunden. Tippe auf „Teilen“ und wähle TikTok.` };
    }
    default: throw new Error('Unbekannter Dateityp');
  }
}
