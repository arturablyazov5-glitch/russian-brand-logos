#!/usr/bin/env node
// Renders README.md, logos/<category>/README.md and NOTICE.md from brands.json + data/catalog.json.
// Usage: node scripts/render-readme.mjs [--brands <path>] [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, LOGOS_DIR, CATALOG_URL, parseArgs, loadBrands, loadCatalog, writeIfChanged, idOf, withUtm,
  escHtml, pluralRu, rel, fail, isMain,
} from './lib.mjs';

const PREVIEW_ON_HOME = 12;
const COLS = 6;
const TOPICS = ['svg', 'logos', 'brand-logos', 'russian-brands', 'russia', 'svg-icons', 'icons', 'figma', 'design-resources', 'brand-assets'];

const logosRu = (n) => `${n} ${pluralRu(n, ['логотип', 'логотипа', 'логотипов'])}`;
const logosEn = (n) => `${n} ${n === 1 ? 'logo' : 'logos'}`;

/** Groups available brands by category in catalog order. */
export function collect(brands, catalog, available) {
  const cats = new Map(catalog.categories.map((c) => [c.slug, { ...c, items: [] }]));
  for (const item of catalog.logos) {
    const id = item.id ?? idOf(item);
    if (!brands[id] || !available.has(id)) continue;
    if (!cats.has(item.categorySlug)) {
      cats.set(item.categorySlug, { slug: item.categorySlug, ru: item.categoryName, en: item.categoryName, items: [] });
    }
    const [cat, slug] = id.split('/');
    cats.get(cat).items.push({ id, slug, name: item.name, url: item.url, brand: brands[id] });
  }
  return [...cats.values()].filter((c) => c.items.length);
}

function grid(items, srcPrefix) {
  const rows = [];
  for (let i = 0; i < items.length; i += COLS) {
    const cells = items.slice(i, i + COLS).map((it) => {
      const name = escHtml(it.name);
      return `<td align="center" width="120"><a href="${escHtml(withUtm(it.url))}"><img src="${srcPrefix}${it.slug}.svg" width="48" alt="${name}"><br><sub>${name}</sub></a></td>`;
    });
    rows.push(`<tr>\n${cells.join('\n')}\n</tr>`);
  }
  return `<table>\n${rows.join('\n')}\n</table>`;
}

function renderHome(cats, catalog) {
  const total = cats.reduce((n, c) => n + c.items.length, 0);
  const catalogTotal = catalog.logos.filter((l) => !l.comingSoon).length;
  const catalogCats = catalog.categories.length;
  const home = withUtm(CATALOG_URL);
  const badge = `[![Full catalog — trace-logos.ru](https://img.shields.io/badge/Full_catalog-trace--logos.ru-7352ec?style=for-the-badge)](${home})`;
  const small = [
    `![Logos](https://img.shields.io/badge/logos-${total}-555?style=flat-square)`,
    `![Categories](https://img.shields.io/badge/categories-${cats.length}-555?style=flat-square)`,
    `![Code: MIT](https://img.shields.io/badge/code-MIT-blue?style=flat-square)`,
  ].join(' ');
  const catTable = (lang) => [
    lang === 'en' ? '| Category | Logos |' : '| Категория | Логотипов |',
    '|---|---:|',
    ...cats.map((c) => `| [${lang === 'en' ? c.en : c.ru}](logos/${c.slug}/README.md) | ${c.items.length} |`),
  ].join('\n');

  const gallery = cats.map((c) => [
    `<a name="cat-${c.slug}"></a>`,
    `### ${c.en} · ${c.ru}`,
    '',
    grid(c.items.slice(0, PREVIEW_ON_HOME), `logos/${c.slug}/`),
    '',
    `[All ${c.items.length} → · Все ${c.items.length} →](logos/${c.slug}/README.md)`,
  ].join('\n')).join('\n\n');

  return `<div align="center">

# Russian Brand Logos

**SVG logos of Russian brands · SVG‑логотипы российских брендов**

${badge}

${small}

[English](#english) · [Русский](#русский) · [Gallery · Галерея](#gallery) · [Topics](#topics)

</div>

## English

A small open set of SVG logos of brands founded in Russia: ${logosEn(total)} in ${cats.length} categories. The files are mirrored from the [Trace Logos](${home}) catalog and refreshed automatically once a day. Every preview links to the brand's page in the catalog.

Files live at \`logos/<category>/<slug>.svg\`; the path matches the brand's catalog address.

### What the full catalog has

The [catalog](${home}) has ${catalogTotal} logos in ${catalogCats} categories, including international brands. On top of the SVG files kept here it offers:

- PNG files alongside SVG;
- logo variants: horizontal lockups, English lettering, earlier versions;
- search in Russian and English, with keyboard layout correction;
- a color editor for SVG logos;
- Figma-ready SVG export and copying to the clipboard;
- downloading a selection as a ZIP archive.

### Categories

${catTable('en')}

### License and trademarks

This is an independent library, not affiliated with or endorsed by the brand owners. Logos and trademarks belong to their respective owners. The MIT license covers only the code in this repository (\`scripts/\`, workflows), not the logos. Rights holders can request removal through an [issue](../../issues/new?template=removal-request.yml). Details: [NOTICE.md](NOTICE.md).

## Русский

Небольшой открытый набор SVG‑логотипов брендов, основанных в России: ${logosRu(total)} в ${cats.length} категориях. Файлы берутся из каталога [Trace Logos](${home}) и обновляются автоматически раз в сутки. Каждое превью ведёт на страницу бренда в каталоге.

Файлы лежат в \`logos/<категория>/<slug>.svg\`; путь совпадает с адресом бренда в каталоге.

### Что есть в полном каталоге

В [каталоге](${home}) ${logosRu(catalogTotal)} в ${catalogCats} категориях, включая международные бренды. Помимо SVG, которые лежат здесь, там есть:

- PNG‑файлы рядом с SVG;
- варианты логотипа: горизонтальные, с латиницей, прежние версии;
- поиск на русском и английском с исправлением раскладки;
- редактор цветов для SVG‑логотипов;
- экспорт SVG, готового для Figma, и копирование в буфер обмена;
- скачивание подборки ZIP‑архивом.

### Категории

${catTable('ru')}

### Лицензия и товарные знаки

Это независимая библиотека, не связанная с владельцами брендов и не одобренная ими. Логотипы и товарные знаки принадлежат их владельцам. Лицензия MIT распространяется только на код репозитория (\`scripts/\`, workflows), но не на логотипы. Правообладатель может запросить удаление через [issue](../../issues/new?template=removal-request.yml). Подробнее: [NOTICE.md](NOTICE.md).

<a name="gallery"></a>

## Gallery · Галерея

The first ${PREVIEW_ON_HOME} logos of each category · Первые ${PREVIEW_ON_HOME} логотипов каждой категории.

${gallery}

## Topics

${TOPICS.map((t) => `- \`${t}\``).join('\n')}
`;
}

function renderCategory(c) {
  const n = c.items.length;
  const catUrl = withUtm(`${CATALOG_URL}${c.slug}/`);
  return `[← All categories · Все категории](../../README.md)

# ${c.en} · ${c.ru}

${logosEn(n)} in this repository · ${logosRu(n)} в репозитории. The whole category with PNG and variants · Вся категория с PNG и вариантами: [trace-logos.ru](${catUrl})

${grid(c.items, '')}
`;
}

function renderNotice(cats) {
  const rows = cats.flatMap((c) => c.items.map((it) => {
    const b = it.brand;
    const owner = b.owner && b.owner_source
      ? `${escMd(b.owner)} ([source · источник](${b.owner_source}))`
      : `[Правообладатель: см. сайт бренда](${withUtm(it.url)})`;
    return `| ${escMd(it.name)} | \`${it.id}\` | ${owner} |`;
  }));
  return `# NOTICE

## English

This is an independent library of brand logos. It is not affiliated with, sponsored or endorsed by any of the brand owners listed below. All logos, trademarks and brand names belong to their respective owners and are provided for identification and reference only.

The MIT license in [LICENSE](LICENSE) applies only to the code of this repository (\`scripts/\`, \`.github/\`). It does not grant any rights to the logos or trademarks.

If you are a rights holder and want a logo removed or corrected, open an issue using the [removal request](../../issues/new?template=removal-request.yml) template.

## Русский

Это независимая библиотека логотипов брендов. Она не связана с владельцами перечисленных ниже брендов, не спонсируется и не одобрена ими. Все логотипы, товарные знаки и названия брендов принадлежат их владельцам и приводятся только для идентификации и справки.

Лицензия MIT из [LICENSE](LICENSE) распространяется только на код репозитория (\`scripts/\`, \`.github/\`) и не даёт никаких прав на логотипы и товарные знаки.

Если вы правообладатель и хотите удалить или исправить логотип, откройте issue по шаблону [запроса на удаление](../../issues/new?template=removal-request.yml).

## Rights holders · Правообладатели

The rights holder is named only when confirmed by an open source; otherwise see the brand's website · Правообладатель указан, только если подтверждён открытым источником; иначе — см. сайт бренда.

| Brand · Бренд | ID | Rights holder · Правообладатель |
|---|---|---|
${rows.join('\n')}
`;
}

const escMd = (s) => String(s).replace(/\|/g, '\\|');

/** Renders all generated Markdown. Returns the list of changed files (relative paths). */
export function render({ brands, catalog, available, dryRun = false }) {
  if (!available) {
    available = new Set(Object.keys(brands).filter((id) => fs.existsSync(path.join(LOGOS_DIR, `${id}.svg`))));
  }
  const cats = collect(brands, catalog, available);
  const out = new Map([
    [path.join(ROOT, 'README.md'), renderHome(cats, catalog)],
    [path.join(ROOT, 'NOTICE.md'), renderNotice(cats)],
    ...cats.map((c) => [path.join(LOGOS_DIR, c.slug, 'README.md'), renderCategory(c)]),
  ]);
  const changed = [];
  for (const [p, text] of out) if (writeIfChanged(p, text, dryRun)) changed.push(rel(p));
  return { changed, cats };
}

if (isMain(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2), ['dry-run']);
  const { brands } = loadBrands(args.brands);
  const catalog = loadCatalog();
  if (!catalog) fail('data/catalog.json not found — run scripts/sync.mjs first');
  const { changed } = render({ brands, catalog, dryRun: !!args['dry-run'] });
  console.log(changed.length ? `${args['dry-run'] ? 'Would update' : 'Updated'}: ${changed.join(', ')}` : 'README is up to date');
}
