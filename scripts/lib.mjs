// Shared helpers for sync.mjs, render-readme.mjs and validate.mjs. No dependencies, Node 20+.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LOGOS_DIR = path.join(ROOT, 'logos');
export const CATALOG_PATH = path.join(ROOT, 'data', 'catalog.json');
export const PREVIEWS_DIR = path.join(ROOT, 'previews');
export const REPORT_DIR = path.join(ROOT, 'reports');

export const SITE = 'https://trace-logos.ru';
export const CATALOG_URL = `${SITE}/logos/`;
export const LOGOS_JSON_URL = `${SITE}/logos.json`;
export const MANIFEST_URL = `${SITE}/logos/manifest.json`;
export const UTM = 'utm_source=github&utm_medium=repository&utm_campaign=russian-brand-logos';

export const MAX_SVG_BYTES = 1024 * 1024; // hard limit: larger files are rejected
export const WARN_SVG_BYTES = 300 * 1024;

/** Minimal flag parser: --flag value | --flag (boolean). */
export function parseArgs(argv, booleans = []) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`Unexpected argument: ${a}`);
    const key = a.slice(2);
    if (booleans.includes(key)) out[key] = true;
    else {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`Flag --${key} needs a value`);
      out[key] = v;
    }
  }
  return out;
}

export const isMain = (metaUrl) => process.argv[1] && metaUrl === pathToFileURL(path.resolve(process.argv[1])).href;

export function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

export function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function toJson(obj) {
  return JSON.stringify(obj, null, 2) + '\n';
}

/** Write only when content differs. Returns true if the file changed (or would change in dry-run). */
export function writeIfChanged(p, content, dryRun = false) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  if (fs.existsSync(p) && fs.readFileSync(p).equals(buf)) return false;
  if (!dryRun) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, buf);
  }
  return true;
}

export const rel = (p) => path.relative(ROOT, p) || '.';

/** id = categorySlug + "/" + last segment of url (CONTRACT). */
export function idOf(item) {
  const slug = new URL(item.url).pathname.split('/').filter(Boolean).pop();
  return `${item.categorySlug}/${slug}`;
}

export function withUtm(url) {
  const u = new URL(url);
  u.search = u.search ? `${u.search.slice(1)}&${UTM}` : UTM;
  return u.href;
}

/** brands.json location: --brands, else ./brands.json, else ./data/brands.json. */
export function resolveBrandsPath(flag) {
  if (flag) return path.resolve(flag);
  for (const p of ['brands.json', 'data/brands.json']) {
    const abs = path.join(ROOT, p);
    if (fs.existsSync(abs)) return abs;
  }
  return path.join(ROOT, 'brands.json');
}

/** Loads brands.json; exits 1 when the file is missing, malformed or has no brands. */
export function loadBrands(flag) {
  const p = resolveBrandsPath(flag);
  if (!fs.existsSync(p)) fail(`brands file not found: ${rel(p)} (pass --brands <path>)`);
  let data;
  try { data = readJson(p); } catch (e) { fail(`cannot parse ${rel(p)}: ${e.message}`); }
  if (!data || data.version !== 1 || typeof data.brands !== 'object' || Array.isArray(data.brands)) {
    fail(`${rel(p)}: expected { "version": 1, "brands": { "<id>": {...} } }`);
  }
  const ids = Object.keys(data.brands);
  if (ids.length === 0) fail(`${rel(p)}: no brands`);
  for (const id of ids) if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(id)) fail(`${rel(p)}: bad brand id "${id}"`);
  return { path: p, brands: data.brands };
}

/** doubtful.json next to brands.json; optional. */
export function loadDoubtful(brandsPath) {
  const p = path.join(path.dirname(brandsPath), 'doubtful.json');
  if (!fs.existsSync(p)) return {};
  return readJson(p).items || {};
}

export function loadCatalog(p = CATALOG_PATH) {
  if (!fs.existsSync(p)) return null;
  const data = readJson(p);
  if (!Array.isArray(data.logos)) throw new Error(`${rel(p)}: no "logos" array`);
  return data;
}

export const escHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Russian plural: plural(5, ['логотип', 'логотипа', 'логотипов']). */
export function pluralRu(n, [one, few, many]) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

// ---------------------------------------------------------------- SVG safety

const BANNED_ELEMENTS = new Set(['script', 'foreignobject', 'iframe', 'embed', 'object', 'audio', 'video', 'handler', 'listener']);
const LINK_ATTRS = new Set(['href', 'xlink:href', 'src']);
const SAFE_LINK = /^(#|data:image\/(png|jpe?g|gif|webp);)/i;
const TAG_RE = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/y;
const ATTR_RE = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function checkCss(text, where, errors) {
  for (const m of text.matchAll(/url\(\s*['"]?([^'")\s]*)/gi)) {
    if (!SAFE_LINK.test(m[1])) errors.push(`external url() in ${where}: ${m[1].slice(0, 60)}`);
  }
  if (/@import/i.test(text)) errors.push(`@import in ${where}`);
  if (/javascript:/i.test(text)) errors.push(`javascript: in ${where}`);
}

/**
 * Well-formedness + safety check without an XML library.
 * Returns { errors: string[], warnings: string[] }.
 */
export function checkSvg(buf) {
  const errors = [], warnings = [];
  const size = buf.length;
  if (size > MAX_SVG_BYTES) errors.push(`too large: ${(size / 1024).toFixed(0)} KB > ${MAX_SVG_BYTES / 1024} KB`);
  else if (size > WARN_SVG_BYTES) warnings.push(`large: ${(size / 1024).toFixed(0)} KB`);
  const text = buf.toString('utf8').replace(/^﻿/, '');
  const stack = [];
  let root = null, roots = 0, i = 0;
  const skip = (open, close) => {
    const end = text.indexOf(close, i + open.length);
    if (end === -1) { errors.push(`unterminated ${open}`); return false; }
    i = end + close.length;
    return true;
  };
  while (errors.length === 0) {
    const lt = text.indexOf('<', i);
    const chunk = text.slice(i, lt === -1 ? text.length : lt);
    if (stack.length === 0 && chunk.trim()) { errors.push('text outside the root element'); break; }
    if (stack.length && stack[stack.length - 1] === 'style') checkCss(chunk, '<style>', errors);
    if (lt === -1) break;
    i = lt;
    if (text.startsWith('<!--', i)) { if (!skip('<!--', '-->')) break; continue; }
    if (text.startsWith('<![CDATA[', i)) {
      const end = text.indexOf(']]>', i);
      if (end === -1) { errors.push('unterminated CDATA'); break; }
      if (stack.length && stack[stack.length - 1] === 'style') checkCss(text.slice(i, end), '<style>', errors);
      i = end + 3; continue;
    }
    if (text.startsWith('<?', i)) { if (!skip('<?', '?>')) break; continue; }
    if (/^<!DOCTYPE/i.test(text.slice(i, i + 9))) {
      const end = text.indexOf('>', i);
      if (end === -1) { errors.push('unterminated DOCTYPE'); break; }
      if (/[[]|<!ENTITY/i.test(text.slice(i, end + 1))) { errors.push('DOCTYPE with internal subset/entities'); break; }
      i = end + 1; continue;
    }
    TAG_RE.lastIndex = i;
    const m = TAG_RE.exec(text);
    if (!m) { errors.push(`malformed tag at offset ${i}: ${text.slice(i, i + 40)}`); break; }
    i = TAG_RE.lastIndex;
    const [, closing, rawName, attrs, selfClose] = m;
    const name = rawName.toLowerCase().replace(/^svg:/, '');
    if (closing) {
      if (attrs.trim() || selfClose) { errors.push(`malformed closing tag </${rawName}>`); break; }
      const top = stack.pop();
      if (top !== name) { errors.push(`mismatched </${rawName}> (expected </${top ?? 'nothing'}>)`); break; }
      continue;
    }
    if (stack.length === 0) {
      roots++;
      if (roots > 1) { errors.push('more than one root element'); break; }
      root = name;
    }
    if (BANNED_ELEMENTS.has(name)) errors.push(`forbidden element <${rawName}>`);
    for (const a of attrs.matchAll(ATTR_RE)) {
      const an = a[1].toLowerCase(), av = a[2] ?? a[3];
      if (an.startsWith('on')) errors.push(`event handler attribute ${a[1]}`);
      else if (LINK_ATTRS.has(an) && !SAFE_LINK.test(av.trim())) errors.push(`external reference ${a[1]}="${av.slice(0, 60)}"`);
      else if (!an.startsWith('xmlns')) checkCss(av, `attribute ${a[1]}`, errors);
    }
    if (!selfClose) stack.push(name);
  }
  if (errors.length === 0) {
    if (stack.length) errors.push(`unclosed <${stack[stack.length - 1]}>`);
    if (root !== 'svg') errors.push(root ? `root element is <${root}>, expected <svg>` : 'no <svg> element');
  }
  return { errors: [...new Set(errors)], warnings };
}

/**
 * Wraps a logo into a fixed 160x96 white card so it stays visible on GitHub's light and dark themes
 * (many logos are dark or white-on-transparent). The original is nested unchanged inside the card.
 */
export function makePreview(svgText) {
  let src = svgText.replace(/^\uFEFF/, '').replace(/<\?xml[^>]*\?>/i, '').replace(/<!DOCTYPE[^>]*>/i, '').trim();
  const root = src.match(/<svg\b[^>]*>/i);
  if (!root) throw new Error('no <svg> root');
  let tag = root[0];
  if (!/\bviewBox\s*=/i.test(tag)) {
    const num = (n) => parseFloat((tag.match(new RegExp(`\\b${n}\\s*=\\s*["']([\\d.]+)`, 'i')) || [])[1]);
    const w = num('width'), h = num('height');
    if (!(w > 0 && h > 0)) throw new Error('no viewBox and no usable width/height');
    tag = tag.replace(/<svg\b/i, `<svg viewBox="0 0 ${w} ${h}"`);
  }
  tag = tag.replace(/\s(?:x|y|width|height)\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
  tag = tag.replace(/<svg\b/i, '<svg x="14" y="14" width="132" height="68" preserveAspectRatio="xMidYMid meet"');
  src = src.replace(root[0], tag);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="96" viewBox="0 0 160 96"><rect x=".5" y=".5" width="159" height="95" rx="12" fill="#fff" stroke="#d0d7de"/>${src}</svg>\n`;
}
