#!/usr/bin/env node
// Validates the repository. Exit 1 on any error.
// Usage: node scripts/validate.mjs [--brands <path>] [--snapshot <logos.json|data/catalog.json>] [--online]
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, LOGOS_DIR, CATALOG_PATH, CATALOG_URL, SITE, UTM, parseArgs, loadBrands, loadCatalog, checkSvg, idOf, rel,
} from './lib.mjs';

const args = parseArgs(process.argv.slice(2), ['online']);
const errors = [], warnings = [];
const err = (m) => errors.push(m), warn = (m) => warnings.push(m);
let checks = 0;

const { brands } = loadBrands(args.brands); // exits 1 when missing or empty
const brandIds = Object.keys(brands);

const snapshotPath = args.snapshot ? path.resolve(args.snapshot) : CATALOG_PATH;
const snapshot = loadCatalog(snapshotPath);
if (!snapshot || snapshot.logos.length === 0) {
  console.error(`✖ snapshot ${rel(snapshotPath)} is missing or empty — run scripts/sync.mjs first`);
  process.exit(1);
}
const pageUrls = new Set(snapshot.logos.filter((l) => !l.comingSoon).map((l) => l.url));
const catSlugs = new Set(snapshot.logos.map((l) => l.categorySlug));
const catalogIds = new Set(snapshot.logos.map((l) => l.id ?? idOf(l)));

// 1. SVG files: well-formed, <svg> root, no scripts/handlers/external refs, reasonable size.
const files = fs.existsSync(LOGOS_DIR)
  ? fs.readdirSync(LOGOS_DIR, { withFileTypes: true, recursive: true }).filter((d) => d.isFile()).map((d) => path.join(d.parentPath ?? d.path, d.name))
  : [];
const svgs = files.filter((f) => f.endsWith('.svg'));
for (const f of svgs) {
  checks++;
  const r = checkSvg(fs.readFileSync(f));
  for (const e of r.errors) err(`${rel(f)}: ${e}`);
  for (const w of r.warnings) warn(`${rel(f)}: ${w}`);
}

// 2. Every brand has an SVG and is in the catalog; no orphans in logos/.
const expected = new Set(brandIds.map((id) => path.join(LOGOS_DIR, `${id}.svg`)));
const usedCats = new Set(brandIds.map((id) => id.split('/')[0]));
for (const id of brandIds) {
  checks++;
  if (!fs.existsSync(path.join(LOGOS_DIR, `${id}.svg`))) err(`brand ${id}: logos/${id}.svg is missing`);
  if (!catalogIds.has(id)) err(`brand ${id}: not found in snapshot ${rel(snapshotPath)}`);
}
for (const f of files) {
  checks++;
  const isCatReadme = path.basename(f) === 'README.md' && path.dirname(path.dirname(f)) === LOGOS_DIR && usedCats.has(path.basename(path.dirname(f)));
  if (!expected.has(f) && !isCatReadme) err(`orphan file ${rel(f)} (not in brands.json)`);
}
for (const cat of usedCats) {
  checks++;
  if (!fs.existsSync(path.join(LOGOS_DIR, cat, 'README.md'))) err(`logos/${cat}/README.md is missing`);
}

// 3. Markdown: local links/previews exist; trace-logos.ru links are known and carry UTM.
const mdFiles = ['README.md', 'NOTICE.md', ...[...usedCats].map((c) => `logos/${c}/README.md`)]
  .map((p) => path.join(ROOT, p)).filter((p) => fs.existsSync(p));
if (!fs.existsSync(path.join(ROOT, 'README.md'))) err('README.md is missing');
const LINK_RE = /\]\(([^)\s]+)\)|(?:href|src)="([^"]+)"/g;
const siteLinks = new Set();
const mdText = new Map();
for (const md of mdFiles) {
  const text = fs.readFileSync(md, 'utf8');
  mdText.set(md, text);
  for (const m of text.matchAll(LINK_RE)) {
    const raw = (m[1] ?? m[2]).replace(/&amp;/g, '&');
    checks++;
    if (raw.startsWith('#') || raw.startsWith('../../issues')) continue;
    if (/^https?:/.test(raw)) {
      const u = new URL(raw);
      if (u.hostname !== new URL(SITE).hostname) continue;
      if (u.search !== `?${UTM}`) err(`${rel(md)}: trace-logos.ru link without UTM: ${raw}`);
      const page = `${u.origin}${u.pathname}`;
      const isCat = page.startsWith(CATALOG_URL) && catSlugs.has(page.slice(CATALOG_URL.length).replace(/\/$/, '')) && page.endsWith('/');
      if (page !== CATALOG_URL && !pageUrls.has(page) && !isCat) err(`${rel(md)}: link not in snapshot: ${page}`);
      siteLinks.add(raw);
      continue;
    }
    const target = path.resolve(path.dirname(md), decodeURIComponent(raw.split(/[?#]/)[0]));
    if (!fs.existsSync(target)) err(`${rel(md)}: broken local link/preview ${raw}`);
  }
}

// 4. Every brand appears in README (category README and the gallery category list).
const home = mdText.get(path.join(ROOT, 'README.md')) ?? '';
for (const id of brandIds) {
  checks++;
  const [cat, slug] = id.split('/');
  const catMd = mdText.get(path.join(LOGOS_DIR, cat, 'README.md')) ?? '';
  if (!catMd.includes(`src="${slug}.svg"`)) err(`brand ${id}: not listed in logos/${cat}/README.md`);
  if (!home.includes(`logos/${cat}/README.md`)) err(`brand ${id}: category ${cat} not linked from README.md`);
}

// 5. Optional: every trace-logos.ru link answers HTTP 200.
if (args.online) {
  const list = [...siteLinks];
  const queue = [...list];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const url = queue.shift();
      checks++;
      try {
        const res = await fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(20000) });
        if (res.status !== 200) err(`online: HTTP ${res.status} for ${url}`);
        await res.body?.cancel();
      } catch (e) { err(`online: ${e.message} for ${url}`); }
    }
  }));
  console.log(`online: checked ${list.length} links`);
}

if (svgs.length === 0) err('SELF-CHECK: no SVG files found in logos/');
for (const w of warnings) console.warn(`⚠ ${w}`);
for (const e of errors) console.error(`✖ ${e}`);
console.log(`${errors.length ? '✖' : '✔'} ${brandIds.length} brands, ${svgs.length} SVG, ${mdFiles.length} Markdown files, ${siteLinks.size} catalog links, ${checks} checks — ${errors.length} errors, ${warnings.length} warnings (snapshot: ${rel(snapshotPath)})`);
process.exit(errors.length ? 1 : 0);
