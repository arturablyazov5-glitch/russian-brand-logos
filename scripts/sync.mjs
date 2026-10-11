#!/usr/bin/env node
// Syncs logos/ with the Trace Logos catalog for the brands listed in brands.json.
// Usage: node scripts/sync.mjs [--from-file <logos.json>] [--manifest-file <manifest.json>]
//                              [--brands <path>] [--dry-run]
// New catalog brands are never added automatically: they go to reports/candidates.{json,md}.
import fs from 'node:fs';
import path from 'node:path';
import {
  LOGOS_DIR, CATALOG_PATH, REPORT_DIR, LOGOS_JSON_URL, MANIFEST_URL,
  parseArgs, fail, readJson, toJson, writeIfChanged, rel, idOf, loadBrands, loadDoubtful, loadCatalog, checkSvg,
} from './lib.mjs';
import { render } from './render-readme.mjs';

const args = parseArgs(process.argv.slice(2), ['dry-run']);
const dryRun = !!args['dry-run'];

async function fetchBuf(url, timeoutMs = 30000) {
  const res = await fetch(new URL(url).href, { signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'russian-brand-logos-sync' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}
const fetchJson = async (url, t) => JSON.parse((await fetchBuf(url, t)).toString('utf8'));

async function loadSource() {
  if (args['from-file']) return readJson(path.resolve(args['from-file']));
  return fetchJson(LOGOS_JSON_URL);
}

/** English category names: --manifest-file, else network, else the previous data/catalog.json. */
async function loadCategoryNames(previous) {
  try {
    const m = args['manifest-file'] ? readJson(path.resolve(args['manifest-file'])) : await fetchJson(MANIFEST_URL, 10000);
    return m.categories.map((c) => ({ slug: c.slug, en: c.section_en ?? null }));
  } catch (e) {
    if (previous?.categories) {
      console.warn(`⚠ manifest unavailable (${e.message}); using category names from ${rel(CATALOG_PATH)}`);
      return previous.categories.map((c) => ({ slug: c.slug, en: c.en }));
    }
    console.warn(`⚠ manifest unavailable (${e.message}); English category names fall back to Russian`);
    return [];
  }
}

function buildCatalog(source, names) {
  if (!Array.isArray(source?.logos) || source.logos.length === 0) fail('catalog has no logos');
  const logos = source.logos.map((l) => {
    const svgUrl = l.svgUrl ?? l.variants?.find((v) => v.svgUrl)?.svgUrl ?? null;
    return {
      id: idOf(l), name: l.name, ...(l.name_en ? { name_en: l.name_en } : {}),
      categorySlug: l.categorySlug, categoryName: l.categoryName, url: l.url, svgUrl,
      ...(l.comingSoon ? { comingSoon: true } : {}),
    };
  });
  const ruBySlug = new Map();
  for (const l of logos) if (!ruBySlug.has(l.categorySlug)) ruBySlug.set(l.categorySlug, l.categoryName);
  const order = [...names.map((n) => n.slug).filter((s) => ruBySlug.has(s)), ...[...ruBySlug.keys()].filter((s) => !names.some((n) => n.slug === s))];
  const enBySlug = new Map(names.map((n) => [n.slug, n.en]));
  const categories = order.map((slug) => ({ slug, ru: ruBySlug.get(slug), en: enBySlug.get(slug) || ruBySlug.get(slug) }));
  return { version: 1, source: LOGOS_JSON_URL, updated: source.updated ?? null, categories, logos };
}

async function pool(items, size, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: size }, async () => { while (queue.length) await fn(queue.shift()); }));
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((d) => d.isFile()).map((d) => path.join(d.parentPath ?? d.path, d.name));
}

function reportMd(r) {
  const lines = [`# Sync report`, '', `Catalog updated: ${r.catalogUpdated ?? 'unknown'} · brands in repo: ${r.synced}`, ''];
  const section = (title, list, fmt) => {
    if (!list.length) return;
    lines.push(`## ${title} (${list.length})`, '', ...list.map(fmt), '');
  };
  section('New catalog brands — candidates (not added automatically)', r.candidates, (c) => `- [ ] \`${c.id}\` — ${c.name} — ${c.url}`);
  section('Brands from brands.json unavailable in the catalog', r.missing, (m) => `- \`${m.id}\` — ${m.reason}`);
  section('Rejected SVG files', r.rejected, (m) => `- \`${m.id}\` — ${m.errors.join('; ')}`);
  if (!r.candidates.length && !r.missing.length && !r.rejected.length) lines.push('Nothing to review.', '');
  lines.push('Add a candidate by putting its id into brands.json (and its origin sources), then run `node scripts/sync.mjs`.');
  return lines.join('\n') + '\n';
}

async function main() {
  const { path: brandsPath, brands } = loadBrands(args.brands);
  const doubtful = loadDoubtful(brandsPath);
  const previous = loadCatalog();
  const catalog = buildCatalog(await loadSource(), await loadCategoryNames(previous));
  const byId = new Map(catalog.logos.map((l) => [l.id, l]));

  const missing = [], rejected = [], changedSvg = [], available = new Set();
  const wanted = Object.keys(brands).sort();
  for (const id of wanted) if (doubtful[id]) console.warn(`⚠ ${id} is in both brands.json and doubtful.json`);

  await pool(wanted, 8, async (id) => {
    const item = byId.get(id);
    const reason = !item ? 'not in catalog' : item.comingSoon ? 'comingSoon in catalog (no page yet)' : !item.svgUrl ? 'no SVG in catalog' : null;
    if (reason) { missing.push({ id, reason }); return; }
    const dest = path.join(LOGOS_DIR, `${id}.svg`);
    let buf;
    try { buf = await fetchBuf(item.svgUrl); } catch (e) {
      if (fs.existsSync(dest)) { console.warn(`⚠ ${id}: download failed (${e.message}), keeping the existing file`); available.add(id); }
      else missing.push({ id, reason: `download failed: ${e.message}` });
      return;
    }
    const { errors, warnings } = checkSvg(buf);
    for (const w of warnings) console.warn(`⚠ ${id}: ${w}`);
    if (errors.length) { rejected.push({ id, url: item.svgUrl, errors }); return; }
    if (writeIfChanged(dest, buf, dryRun)) changedSvg.push(rel(dest));
    available.add(id);
  });
  if (available.size === 0) fail('no brands from brands.json found in the catalog');

  // logos/ is owned by sync: remove everything that is neither a synced SVG nor a category README.
  const keep = new Set([...available].flatMap((id) => [path.join(LOGOS_DIR, `${id}.svg`), path.join(LOGOS_DIR, id.split('/')[0], 'README.md')]));
  const removed = listFiles(LOGOS_DIR).filter((f) => !keep.has(f));
  if (!dryRun) {
    for (const f of removed) fs.rmSync(f);
    for (const d of fs.existsSync(LOGOS_DIR) ? fs.readdirSync(LOGOS_DIR) : []) {
      const abs = path.join(LOGOS_DIR, d);
      if (fs.statSync(abs).isDirectory() && fs.readdirSync(abs).length === 0) fs.rmdirSync(abs);
    }
  }

  const catalogChanged = writeIfChanged(CATALOG_PATH, toJson(catalog), dryRun);
  const { changed: changedMd } = render({ brands, catalog, available, dryRun });

  // Candidates: brands that appeared in the catalog since the previous sync and are not triaged yet.
  const prevIds = previous ? new Set(previous.logos.map((l) => l.id)) : null;
  const candidates = prevIds
    ? catalog.logos.filter((l) => !l.comingSoon && !prevIds.has(l.id) && !brands[l.id] && !doubtful[l.id])
      .map(({ id, name, url }) => ({ id, name, url }))
    : [];
  const sortById = (a, b) => a.id.localeCompare(b.id);
  const report = {
    version: 1, catalogUpdated: catalog.updated, synced: available.size, baseline: !prevIds,
    candidates: candidates.sort(sortById), missing: missing.sort(sortById), rejected: rejected.sort(sortById),
  };
  if (!dryRun) {
    writeIfChanged(path.join(REPORT_DIR, 'candidates.json'), toJson(report));
    writeIfChanged(path.join(REPORT_DIR, 'candidates.md'), reportMd(report));
  }

  const verb = dryRun ? 'would change' : 'changed';
  console.log(`✔ ${available.size}/${wanted.length} brands synced${dryRun ? ' (dry run, nothing written)' : ''}`);
  if (changedSvg.length) console.log(`  SVG ${verb}: ${changedSvg.length}`);
  if (removed.length) console.log(`  ${dryRun ? 'would remove' : 'removed'}: ${removed.map(rel).join(', ')}`);
  if (catalogChanged) console.log(`  ${rel(CATALOG_PATH)} ${verb}`);
  if (changedMd.length) console.log(`  Markdown ${verb}: ${changedMd.join(', ')}`);
  if (!changedSvg.length && !removed.length && !catalogChanged && !changedMd.length) console.log('  no changes');
  if (report.baseline) console.log('  first sync: catalog baseline saved, candidates start from the next run');
  for (const [label, list] of [['candidates', candidates], ['missing', missing], ['rejected', rejected]]) {
    if (list.length) console.log(`  ${label}: ${list.length} → ${rel(path.join(REPORT_DIR, 'candidates.md'))}`);
  }
}

main().catch((e) => fail(e.stack || e.message));
