// Builds index.html for the W/Rhinos site from the two source documents.
const fs = require('fs');
const path = require('path');
const dir = __dirname;

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const tidy = s => s.replace(/[–—]/g, '--').replace(/\s+--\s+/g, ' — ').replace(/--/g, '—').replace(/\s+/g, ' ').trim();
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ---------- Framework ----------
const raw = fs.readFileSync(path.join(dir, 'framework.txt'), 'utf8').replace(/\f/g, '').replace(/[–—]/g, '--').split(/\r?\n/);
const tocStart = raw.findIndex(l => l.trim() === 'Contents');
const bodyStart = raw.findIndex((l, i) => i > tocStart + 2 && /^Part I -- /.test(l.trim()));

// TOC entries → expected headings in order, with levels
const toc = [];
let part = 0;
for (let i = tocStart + 1; i < bodyStart; i++) {
  const m = raw[i].match(/^(\s*)(.+?)\.{3,}\s*\d+\s*$/);
  if (!m) continue;
  const indent = m[1].length, title = m[2].trim();
  let level;
  if (/^Part [IV]+ --/.test(title)) { level = 2; part++; }
  else if (/^Standard /.test(title)) level = 3;
  else if (part === 3) level = title === 'Introduction' ? 3 : 4;
  else level = indent >= 6 ? 4 : 3;
  toc.push({ title, level });
}

const boldLeads = [
  'How the money moves.', 'The administration fee.', 'Funding and card benefits.', 'Where funds are held.',
  'What the cost includes.', 'Travel is arranged by riders.', 'If a rider withdraws.', 'If a trip is cancelled.',
  'Unpaid balances.', 'The status of these arrangements.', 'Immediate safety, during a trip.',
  'Conduct, or exclusion from future trips.',
  'This is a parent-accompanied community, not a supervised youth activity.'
];
const fmtPara = t => {
  t = esc(tidy(t));
  for (const b of boldLeads) if (t.startsWith(esc(b))) return `<strong>${esc(b)}</strong>${t.slice(esc(b).length)}`;
  return t;
};
const fmtBullet = t => {
  t = tidy(t);
  const m = t.match(/^([^.]{3,70}\.)\s+(.+)$/);
  if (m && m[1].split(' ').length <= 9) return `<strong>${esc(m[1])}</strong> ${esc(m[2])}`;
  return esc(t);
};

let ti = 0;
const blocks = []; // {type, text|items, level, id}
let cur = null;
const flush = () => { if (cur) blocks.push(cur); cur = null; };
const norm = s => tidy(s).toLowerCase();

for (let i = bodyStart; i < raw.length; i++) {
  const line = raw[i];
  const t = line.trim();
  if (!t) { if (cur && cur.type !== 'ul') flush(); continue; }
  // heading?
  if (ti < toc.length) {
    const want = norm(toc[ti].title);
    let used = 0;
    if (norm(t) === want) used = 1;
    else if (i + 1 < raw.length && norm(t + ' ' + raw[i + 1]) === want) used = 2;
    if (used) {
      flush();
      const h = toc[ti++];
      blocks.push({ type: 'h', level: h.level, text: tidy(h.title), id: slug(h.title) });
      i += used - 1;
      continue;
    }
  }
  const indent = line.match(/^\s*/)[0].length;
  if (/^•/.test(t)) {
    if (!cur || cur.type !== 'ul') { flush(); cur = { type: 'ul', items: [] }; }
    cur.items.push(t.replace(/^•\s*/, ''));
    continue;
  }
  if (cur && cur.type === 'ul') {
    if (indent >= 4) { cur.items[cur.items.length - 1] += ' ' + t; continue; }
    flush();
  }
  const isQuote = indent >= 5;
  if (cur && cur.type === (isQuote ? 'q' : 'p')) {
    // paragraph break heuristic: previous line short and sentence-final
    const prev = cur.last;
    if (prev.length < 62 && /[.?!:]$/.test(prev)) { flush(); }
    else { cur.text += ' ' + t; cur.last = t; continue; }
  } else flush();
  cur = { type: isQuote ? 'q' : 'p', text: t, last: t };
}
flush();

// unique ids + part grouping
const seen = {};
for (const b of blocks) if (b.type === 'h') { let id = 'fw-' + b.id; if (seen[id]) id += '-' + (++seen[id]); else seen[id] = 1; b.id = id; }

let fwHtml = '';
let fwToc = '';
let openPart = false;
for (const b of blocks) {
  if (b.type === 'h') {
    if (b.level === 2) {
      if (openPart) fwHtml += '</section>';
      const [num, name] = b.text.split(' — ');
      fwHtml += `<section class="part"><h2 id="${b.id}"><span class="part-num">${esc(num)}</span>${esc(name)}</h2>`;
      openPart = true;
      fwToc += `<li class="toc-part"><a href="#${b.id}"><span>${esc(num.replace('Part ', ''))}</span>${esc(name)}</a></li>`;
    } else {
      fwHtml += `<h${b.level} id="${b.id}">${esc(b.text)}</h${b.level}>`;
      if (b.level === 3) fwToc += `<li class="toc-sec"><a href="#${b.id}">${esc(b.text)}</a></li>`;
    }
  } else if (b.type === 'p') fwHtml += `<p>${fmtPara(b.text)}</p>`;
  else if (b.type === 'q') {
    const t = tidy(b.text);
    fwHtml += t.startsWith('Freedom through Responsibility')
      ? `<p class="motto">${esc(t)}</p>` : `<blockquote>${esc(t)}</blockquote>`;
  } else if (b.type === 'ul') fwHtml += '<ul>' + b.items.map(x => `<li>${fmtBullet(x)}</li>`).join('') + '</ul>';
}
if (openPart) fwHtml += '</section>';
if (ti !== toc.length) console.error('Unmatched headings from:', toc.slice(ti).map(x => x.title));

// ---------- Constitution ----------
const xml = fs.readFileSync(path.join(dir, 'constitution.xml'), 'utf8');
const paras = (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || [])
  .map(p => [...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m => m[1]).join(''))
  .map(s => s.replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim())
  .filter(Boolean);
let coHtml = '', coToc = '';
const adoptIdx = paras.findIndex(p => /^Adoption and initial appointments/.test(p));
for (const p of paras.slice(0, adoptIdx)) {
  let m;
  if ((m = p.match(/^(\d+)\.\s+(.+)$/))) {
    const id = 'co-' + m[1];
    coHtml += `<h3 id="${id}"><span class="clause-num">${m[1]}</span>${esc(m[2])}</h3>`;
    coToc += `<li class="toc-sec"><a href="#${id}"><span>${m[1]}</span>${esc(m[2])}</a></li>`;
  } else if ((m = p.match(/^(\d+\.\d+)\s+(.+)$/))) {
    coHtml += `<p class="clause" id="co-${m[1].replace('.', '-')}"><span class="clause-num">${m[1]}</span><span>${esc(tidy(m[2]))}</span></p>`;
  }
}
// adoption block
const roles = ['Chair', 'Secretary', 'Treasurer', 'Founding Member'];
const signers = [];
const tail = paras.slice(adoptIdx);
for (let i = 0; i < tail.length; i++) if (roles.includes(tail[i]) && tail[i + 1] && !/^Signature/.test(tail[i + 1])) signers.push([tail[i], tail[i + 1]]);
coHtml += `<h3 id="co-adoption"><span class="clause-num">—</span>Adoption and initial appointments</h3>
<p>This Constitution was adopted by the founding members of W/Rhinos Cycling Club at a meeting held on 20 September 2026.</p>
<dl class="signers">${signers.map(([r, n]) => `<div><dt>${esc(r)}</dt><dd>${esc(n)}</dd></div>`).join('')}</dl>
<p class="note">The initial Committee and founding members are those recorded in the signed founding-meeting minutes and schedules.</p>`;
coToc += `<li class="toc-sec"><a href="#co-adoption"><span>—</span>Adoption</a></li>`;

const officers = signers.filter(([r]) => r !== 'Founding Member');

// ---------- Page ----------
const tpl = fs.readFileSync(path.join(dir, 'template.html'), 'utf8');
const out = tpl
  .replace('{{FRAMEWORK}}', fwHtml)
  .replace('{{FRAMEWORK_TOC}}', fwToc)
  .replace('{{CONSTITUTION}}', coHtml)
  .replace('{{CONSTITUTION_TOC}}', coToc)
  .replace('{{OFFICERS}}', officers.map(([r, n]) => `<div><dt>${esc(r)}</dt><dd>${esc(n)}</dd></div>`).join(''));

const head = `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="W/Rhinos Cycling Club, Birmingham. How to join, the Framework and the Constitution.">
<title>W/Rhinos Cycling Club</title>
<link rel="icon" type="image/png" href="img/favicon.png">
<link rel="apple-touch-icon" href="img/badge.png">
<meta property="og:title" content="W/Rhinos Cycling Club">
<meta property="og:description" content="Freedom through Responsibility. Adventure through Community. How to join, plus the Framework and Constitution.">
<meta property="og:image" content="https://wrhinos.com/img/badge.png">
<meta property="og:url" content="https://wrhinos.com/">
<meta property="og:type" content="website">
<meta name="theme-color" content="#161616">
<style>[hidden]{display:none!important}body{margin:0}img{max-width:100%}</style>
`;
fs.writeFileSync(path.join(dir, '..', 'index.html'), head + out.replace('<title>W/Rhinos Cycling Club</title>\n', '').replace('</style>', '</style>\n</head>\n<body>') + '\n</body>\n</html>\n');
console.log('framework blocks', blocks.length, 'headings matched', ti, '/', toc.length, 'signers', signers.length, 'bytes', out.length);

// ---------- Privacy notice page ----------
const style = tpl.match(/<link rel="stylesheet"[^>]*>\s*<style>[\s\S]*?<\/style>/)[0];
const privacyBody = fs.readFileSync(path.join(dir, 'privacy.html'), 'utf8');
const privacyHead = head
  .replace('<title>W/Rhinos Cycling Club</title>', '<title>W/Rhinos Privacy Notice</title>')
  .replace('href="img/favicon.png"', 'href="/img/favicon.png"')
  .replace('href="img/badge.png"', 'href="/img/badge.png"')
  .replace(/<meta name="description" content="[^"]*">/, '<meta name="description" content="How W/Rhinos Cycling Club looks after members\' personal information.">')
  .replace('content="https://wrhinos.com/"', 'content="https://wrhinos.com/privacy/"');
fs.mkdirSync(path.join(dir, '..', 'privacy'), { recursive: true });
fs.writeFileSync(path.join(dir, '..', 'privacy', 'index.html'), privacyHead + style + '\n</head>\n<body>\n' + privacyBody + '\n</body>\n</html>\n');
console.log('privacy page written');
