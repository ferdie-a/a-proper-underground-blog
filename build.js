import { readdir, readFile, writeFile, mkdir, rm, cp } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import {
  parsePost, parsePublishedPath, renderBody, escapeHtml, hasBrokenBlock, splitPills, pillProblem, FOLDER, RESERVED_SLUGS,
  BLOCK_KEYS, unknownKey,
} from './site/lib/post.js';
import { renderLearnsBox, renderLearnsPage, renderList } from './lib/learns-pages.js';

const CONFIG_FIELDS = ['name', 'lang', 'learns.title', 'learns.intro'];
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

export async function readSiteConfig(dir) {
  let text;
  try {
    text = await readFile(join(dir, 'site.json'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`site.json: not found in ${resolve(dir)}`);
    throw error;
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`site.json: not valid JSON (${error.message})`);
  }
  if (!isObject(data)) throw new Error('site.json: expected an object');
  for (const field of CONFIG_FIELDS) {
    const value = field.split('.').reduce((obj, key) => (isObject(obj) ? obj[key] : undefined), data);
    if (typeof value !== 'string' || value.trim() === '') throw new Error(`site.json: missing "${field}"`);
  }
  if (Object.hasOwn(data, 'shortName') && (typeof data.shortName !== 'string' || data.shortName.trim() === '')) {
    throw new Error('site.json: "shortName" must be a non-empty string when present');
  }
  const config = { name: data.name, lang: data.lang, learns: { title: data.learns.title, intro: data.learns.intro } };
  return Object.hasOwn(data, 'shortName') ? { ...config, shortName: data.shortName } : config;
}

export function shortNameOf(config) {
  if (config.shortName) return config.shortName.trim();
  return Array.from(config.name.trim()).slice(0, 12).join('').trim();
}

const REPO = 'https://github.com/ferdie-a/a-proper-underground-blog';
const DEMO_NOTE = '<div id="demo-note" hidden><p>This is a mock blog. Clone the repo and make it yours: '
  + `<a href="${REPO}" rel="noopener">github.com/ferdie-a/a-proper-underground-blog</a>. `
  + 'Open <a href="/write">/write</a> and type <code>prova</code> as the password to try the editor.</p>'
  + '<button id="demo-close" type="button">close</button></div>\n';

function page(config, title, main, { script = false, learns = '', demo = false } = {}) {
  const extra = script ? '\n<script src="/learns.js" defer></script>' : '';
  const nav = (learns ? `<a href="/learns">${escapeHtml(learns.toLowerCase())}</a>` : '')
    + '<button id="theme" type="button" hidden></button><a id="write" href="/write" hidden>write</a>';
  return `<!doctype html>
<html lang="${escapeHtml(config.lang)}">
<head>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/style.css">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<script src="/theme.js"></script>${extra}
</head>
<body>
${demo ? DEMO_NOTE : ''}<header><h1><a href="/">${escapeHtml(config.name)}</a></h1> <nav>${nav}</nav></header>
<main>
${main}
</main>
<footer>${escapeHtml(config.name)}</footer>
</body>
</html>
`;
}

function editorPage(config, demo) {
  const demoMeta = demo ? '\n<meta name="demo" content="1">' : '';
  return `<!doctype html>
<html lang="${escapeHtml(config.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">${demoMeta}
<title>${escapeHtml(config.name)}</title>
<link rel="stylesheet" href="/style.css">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="manifest" href="/manifest.json">
<link rel="apple-touch-icon" href="/icons/icon-512.png">
<script src="/theme.js"></script>
<script type="module" src="/write.js"></script>
</head>
<body class="write">
${demo ? DEMO_NOTE : ''}<textarea id="text" hidden></textarea>
<div id="list" hidden></div>
<div class="bar">
  <span id="cmds"></span>
  <button id="theme" type="button" hidden></button>
  <div id="status"></div>
</div>
</body>
</html>
`;
}

function manifest(config) {
  const data = {
    name: config.name,
    short_name: shortNameOf(config),
    start_url: '/write',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: [{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
  };
  return JSON.stringify(data, null, 2) + '\n';
}

const SW_PLACEHOLDER = "const VERSION = 'dev';";

async function stampServiceWorker(siteDir, outDir, generated) {
  const entries = await readdir(siteDir, { recursive: true, withFileTypes: true });
  const files = new Map();
  for (const e of entries.filter((entry) => entry.isFile())) {
    const name = relative(siteDir, join(e.parentPath, e.name)).replace(/\\/g, '/');
    if (name !== 'sw.js') files.set(name, () => readFile(join(siteDir, name)));
  }
  for (const [name, text] of Object.entries(generated)) files.set(name, async () => text);
  const hash = createHash('sha1');
  for (const name of [...files.keys()].sort()) {
    hash.update(name + '\n');
    hash.update(await files.get(name)());
  }
  const version = hash.digest('hex').slice(0, 12);
  const target = join(outDir, 'sw.js');
  const source = await readFile(target, 'utf8');
  if (!source.includes(SW_PLACEHOLDER)) throw new Error('sw.js: the version placeholder is missing');
  await writeFile(target, source.replace(SW_PLACEHOLDER, `const VERSION = '${version}';`));
}

function checkBlock(meta, section, file) {
  const unknown = unknownKey(meta);
  if (unknown) throw new Error(`${file}: unknown key "${unknown}" in the time block (expected ${BLOCK_KEYS.join(', ')})`);
  if (Object.hasOwn(meta, 'section') && meta.section !== section) {
    throw new Error(`section "${meta.section}" in ${file}: the folder says ${section}`);
  }
}

const RESERVED_LEARN_SLUGS = ['index'];

async function readPieces(dir, section) {
  const folder = FOLDER[section];
  const names = (await readdir(dir).catch(() => [])).sort().reverse();
  const pieces = [];
  for (const name of names) {
    const file = `${folder}/${name}`;
    const where = parsePublishedPath(file);
    if (!where) continue;
    const taken = pieces.some((p) => p.slug === where.slug);
    if (section === 'post' && (taken || RESERVED_SLUGS.includes(where.slug))) {
      throw new Error(`address already used: ${where.slug} (${name})`);
    }
    if (section === 'learn' && (taken || RESERVED_LEARN_SLUGS.includes(where.slug))) {
      throw new Error(`address already used: ${folder}/${where.slug} (${name})`);
    }
    const { title, body, meta } = parsePost(await readFile(join(dir, name), 'utf8'));
    checkBlock(meta, section, file);
    if (hasBrokenBlock(`${title}\n${body}`)) throw new Error(`broken time block: ${file}`);
    pieces.push({ date: where.date, slug: where.slug, title, body, file });
  }
  return pieces;
}

async function readLearns(dir) {
  const learns = [];
  for (const learn of await readPieces(dir, 'learn')) {
    const problem = pillProblem(learn.body);
    if (problem) throw new Error(`${learn.file}: ${problem}`);
    const { body, pills } = splitPills(learn.body);
    learns.push({ ...learn, body, pills });
  }
  return learns;
}

function renderPiece(piece) {
  return `<article>\n<h2>${escapeHtml(piece.title)}</h2> <address>${escapeHtml(piece.date)}</address>\n<pre>${renderBody(piece.body)}</pre>\n</article>`;
}

export async function build({
  postsDir = 'posts', learnsDir = 'learns', siteDir = 'site', outDir = 'public', configDir = '.',
  demo = process.env.BLOG_DEMO === '1',
} = {}) {
  const config = await readSiteConfig(configDir);
  const posts = await readPieces(postsDir, 'post');
  const learns = await readLearns(learnsDir);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await cp(siteDir, outDir, { recursive: true });
  const generated = { 'write.html': editorPage(config, demo), 'manifest.json': manifest(config) };
  for (const [name, text] of Object.entries(generated)) await writeFile(join(outDir, name), text);
  await stampServiceWorker(siteDir, outDir, generated);

  const name = config.name;
  const frame = { learns: learns.length > 0 ? config.learns.title : '', demo };
  for (const p of posts) {
    await writeFile(join(outDir, p.slug + '.html'), page(config, `${p.title} - ${name}`, renderPiece(p), frame));
  }
  if (learns.length > 0) {
    await mkdir(join(outDir, 'learns'), { recursive: true });
    for (const l of learns) {
      await writeFile(join(outDir, 'learns', l.slug + '.html'), page(config, `${l.title} - ${name}`, renderPiece(l), frame));
    }
    const learnsPage = renderLearnsPage(learns, config.learns);
    await writeFile(join(outDir, 'learns.html'), page(config, `${config.learns.title} - ${name}`, learnsPage, { ...frame, script: true }));
  }

  const learnsBox = renderLearnsBox(learns, config.learns);
  const home = `${learnsBox}${renderList(posts.map((p) => ({ ...p, href: '/' + escapeHtml(p.slug) })))}`;
  await writeFile(join(outDir, 'index.html'), page(config, name, home, { ...frame, script: learnsBox !== '' }));
  await writeFile(join(outDir, '404.html'), page(config, `404 - ${name}`, '<pre>404</pre>', frame));
  return posts.length;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    console.log(`built ${await build()} posts`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
