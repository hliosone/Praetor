// Renders the submission PDFs (run by build-pdfs.sh, which sets WORK and SOURCE and checks the PDFs afterwards).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const root = process.cwd();
const work = process.env.WORK;
const fromHead = process.env.SOURCE !== 'worktree';
const REPO = 'https://github.com/hliosone/Praetor/blob/main/';
// mermaid 10 bundles the ELK layout, which stacks the big flowcharts top to bottom as the earlier PDFs did.
const MERMAID = 'https://cdn.jsdelivr.net/npm/mermaid@10.9.3/dist/mermaid.min.js';
// Static IBM Plex (fontsource) rather than Google Fonts' variable font, which Chromium embeds as Type 3 glyphs.
const FONTS = ['ibm-plex-sans@5.2.8/400.css', 'ibm-plex-sans@5.2.8/400-italic.css', 'ibm-plex-sans@5.2.8/600.css', 'ibm-plex-mono@5.2.7/400.css', 'ibm-plex-mono@5.2.7/600.css']
  .map((f) => `https://cdn.jsdelivr.net/npm/@fontsource/${f}`);

const DOCS = [
  { out: 'README.pdf', title: 'README', sources: ['README.md'] },
  { out: 'ARCHITECTURE.pdf', title: 'Technical documentation', sources: ['docs/ARCHITECTURE.md'] },
  { out: 'SELF_ASSESSMENT.pdf', title: 'Security self-assessment', sources: ['docs/security/SELF_ASSESSMENT.md'] },
  // The server's run first (the deck's evidence QR points to it), then the generated evidence run of 2026-10-18.
  { out: 'EVIDENCE.pdf', title: 'Execution evidence', sources: ['docs/EVIDENCE-SERVER.md', 'docs/EVIDENCE.md'] },
];

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', env: { ...process.env, TZ: 'UTC' } });
const sha = git('rev-parse', '--short=10', 'HEAD').trim();
const date = git('show', '-s', '--format=%cd', '--date=format-local:%Y-%m-%d %H:%M', 'HEAD').trim();
const stamp = fromHead ? `commit ${sha}` : `the working tree on commit ${sha}`;
const markdown = (p) => (fromHead ? git('show', `HEAD:${p}`) : readFileSync(p, 'utf8'));
// pandoc marks a mermaid block <pre class="mermaid">, which mermaid would render on load before prepare() runs: rename it.
const html = (md) =>
  execFileSync('pandoc', ['-f', 'gfm', '-t', 'html5', '--wrap=none'], { input: md, encoding: 'utf8' }).replaceAll('<pre class="mermaid">', '<pre class="mermaid-src">');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const CSS = `
@page { size: A4; margin: 16mm 16mm 18mm 16mm; }
:root { color-scheme: light; }
html { font-family: 'IBM Plex Sans', 'Noto Sans CJK SC', 'Noto Sans', sans-serif; font-size: 9.6pt; line-height: 1.5; color: #1b1f24; background: #fff; }
body { margin: 0; }
code, pre { font-family: 'IBM Plex Mono', 'Noto Sans Mono CJK SC', monospace; font-size: 0.86em; }
code { background: #f0f2f5; border: 1px solid #e1e4e8; border-radius: 3px; padding: 0 0.25em; overflow-wrap: anywhere; }
pre { background: #f6f8fa; border: 1px solid #e1e4e8; border-radius: 4px; padding: 8px 10px; white-space: pre-wrap; overflow-wrap: anywhere; break-inside: avoid; }
pre code { background: none; border: 0; padding: 0; }
a { color: #0b57d0; text-decoration: none; }
h1, h2, h3, h4 { font-weight: 600; line-height: 1.25; break-after: avoid; }
h1 { font-size: 20pt; margin: 0.4em 0 0.5em; }
h2 { font-size: 14pt; margin: 1.4em 0 0.5em; padding-top: 0.5em; border-top: 1px solid #d0d7de; }
h3 { font-size: 11pt; margin: 1.2em 0 0.4em; }
blockquote { margin: 0.8em 0; padding: 0.5em 1em; border-left: 4px solid #0b57d0; background: #f3f6fc; font-weight: 600; }
blockquote p { margin: 0; }
table { border-collapse: collapse; width: 100%; margin: 0.8em 0; font-size: 0.9em; }
th, td { border-bottom: 1px solid #e1e4e8; padding: 4px 6px; text-align: left; vertical-align: top; overflow-wrap: break-word; }
th { background: #f6f8fa; font-weight: 600; }
tr { break-inside: avoid; }
img { max-width: 100%; max-height: 110mm; break-inside: avoid; }
.mermaid { margin: 0.8em 0; padding: 10px; border: 1px solid #e1e4e8; border-radius: 6px; text-align: center; break-inside: avoid; }
.mermaid svg { max-width: 100%; height: auto; max-height: 235mm; }
.doc-head { border-bottom: 2px solid #1b1f24; padding-bottom: 6px; margin-bottom: 14px; }
.doc-head .name { font-size: 13pt; font-weight: 600; }
.doc-head .meta { font-size: 8pt; color: #57606a; }
section + section { break-before: page; }
`;

function page(doc) {
  const sections = doc.sources.map((p) => `<section data-src="${p}">\n${html(markdown(p))}\n</section>`).join('\n');
  const names = doc.sources.map((p) => `<a href="${REPO}${p}">${esc(p)}</a>`).join(' and ');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Praetor: ${esc(doc.title)}</title>
${FONTS.map((f) => `<link rel="stylesheet" href="${f}">`).join("")}<style>${CSS}</style><script src="${MERMAID}"></script></head>
<body><div class="doc-head"><div class="name">Praetor</div>
<div class="meta">FinTechathon 2026 · International Track · Topic F: Agent Wallet · ${esc(doc.title)}</div>
<div class="meta">Source ${names} at ${esc(stamp)} (committed ${date} UTC)</div></div>
${sections}
</body></html>`;
}

// In the page: unique ids across sections, links resolved (in-PDF anchor, else GitHub), images and anchors checked,
// mermaid rendered and checked. Returns the problems found.
async function prepare({ repoUrl, rootUrl }) {
  const problems = [];
  const sections = [...document.querySelectorAll('section[data-src]')];
  const seen = new Set();
  const firstId = new Map();
  sections.forEach((s, i) => {
    const renamed = new Map();
    for (const el of s.querySelectorAll('[id]')) {
      if (seen.has(el.id)) {
        renamed.set(el.id, `s${i}-${el.id}`);
        el.id = `s${i}-${el.id}`;
      }
      seen.add(el.id);
    }
    for (const a of s.querySelectorAll('a[href^="#"]')) {
      const id = decodeURIComponent(a.getAttribute('href').slice(1));
      if (renamed.has(id)) a.setAttribute('href', `#${renamed.get(id)}`);
    }
    firstId.set(s.dataset.src, s.querySelector('h1[id], h2[id]')?.id);
  });
  for (const s of sections) {
    const base = new URL(s.dataset.src, rootUrl);
    for (const a of s.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href');
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#')) continue;
      const u = new URL(href, base);
      const path = decodeURIComponent(u.pathname.slice(new URL(rootUrl).pathname.length));
      if (firstId.has(path)) a.setAttribute('href', `#${u.hash ? decodeURIComponent(u.hash.slice(1)) : firstId.get(path)}`);
      else a.setAttribute('href', `${repoUrl}${path}${u.hash}`);
    }
    for (const img of s.querySelectorAll('img[src]')) img.src = new URL(img.getAttribute('src'), base).href;
  }
  // A shortened hash in a table cell (0x12345678...9abcdef0) stays on one line.
  for (const c of document.querySelectorAll('td a code')) if (c.textContent.length <= 24) c.style.whiteSpace = 'nowrap';
  for (const a of document.querySelectorAll('a[href^="#"]')) {
    const id = decodeURIComponent(a.getAttribute('href').slice(1));
    if (!document.getElementById(id) && !document.getElementsByName(id).length) problems.push(`no target for link #${id}`);
  }
  await Promise.all([...document.images].map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; }))));
  for (const img of document.images) if (!img.naturalWidth) problems.push(`image not found: ${img.getAttribute('src')}`);
  const blocks = [...document.querySelectorAll('pre.mermaid-src')];
  if (blocks.length) {
    for (const pre of blocks) {
      const div = document.createElement('div');
      div.className = 'mermaid';
      div.textContent = pre.textContent;
      pre.replaceWith(div);
    }
    mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'strict', fontFamily: 'IBM Plex Sans, sans-serif', flowchart: { defaultRenderer: 'elk' } });
    try {
      await mermaid.run({ querySelector: 'div.mermaid' });
    } catch (e) {
      problems.push(`mermaid: ${e.message ?? e}`);
    }
    for (const d of document.querySelectorAll('div.mermaid')) if (!d.querySelector('svg') || /Syntax error/i.test(d.textContent)) problems.push('a mermaid diagram did not render');
  }
  await document.fonts.ready;
  if (document.body.textContent.includes(String.fromCharCode(0x2014))) problems.push('U+2014 in the text');
  return problems;
}

const require = createRequire(join(resolve(process.env.PLAYWRIGHT_FROM ?? join(root, 'apps/web')), 'noop.js'));
const { chromium } = require('@playwright/test');
const browser = await chromium.launch();
let failed = false;
try {
  for (const doc of DOCS) {
    const file = join(work, doc.out.replace(/\.pdf$/, '.html'));
    writeFileSync(file, page(doc));
    const p = await browser.newPage();
    await p.goto(`file://${file}`, { waitUntil: 'networkidle' });
    const problems = await p.evaluate(prepare, { repoUrl: REPO, rootUrl: `file://${root}/` });
    if (problems.length) {
      failed = true;
      console.error(`render-pdfs: ${doc.out}:\n  ${problems.join('\n  ')}`);
      await p.close();
      continue;
    }
    await p.pdf({
      path: join(root, 'docs/submission', doc.out),
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="width:100%;margin:0 16mm;display:flex;justify-content:space-between;font-family:'IBM Plex Sans',sans-serif;font-size:7pt;color:#57606a"><span>Praetor · ${esc(doc.title)} · ${esc(stamp)}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
      margin: { top: '16mm', bottom: '18mm', left: '16mm', right: '16mm' },
    });
    await p.close();
    console.log(`render-pdfs: docs/submission/${doc.out}`);
  }
} finally {
  await browser.close();
}
if (failed) process.exit(1);
