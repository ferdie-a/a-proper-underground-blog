import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, parse, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { build, readSiteConfig } from '../build.js';
import { RESERVED_SLUGS } from '../site/lib/post.js';
import * as icons from '../lib/icons.js';

const { PENCIL, ARROW } = icons;

const POST_A = 'First post\n\nHello <script>alert(1)</script> and https://example.com.\n\n--\nstarted: 2026-10-03T21:14-05:00\nfinished: 2026-10-05T08:02-05:00\nwritten: 86 min\nsessions: 3\n';
const POST_B = 'Second post\n\nText.\n';
const TWO = { '2026-10-05-first-post.txt': POST_A, '2026-10-01-second-post.txt': POST_B };

const LEARN_A = 'Why my phone showed the old page\n\nI changed one line and nothing moved.\n\nThe copy was old.\n\npill: Why did the phone show the old page? | Its saved copy answered first.\npill: What makes the copy change? | A new <sw.js> & a reload.\n\n--\nstarted: 2026-10-18T21:14-05:00\nfinished: 2026-10-19T08:02-05:00\nwritten: 20 min\nsessions: 1\nsection: learn\n';
const LEARN_B = 'A test that lied\n\nIt was green.\n\npill: When is a green test a lie? | When it checks the wrong thing.\npill: How do you catch it? | Make it fail first.\n';
const LEARNS = { '2026-10-19-why-my-phone-showed-the-old-page.txt': LEARN_A, '2026-10-12-a-test-that-lied.txt': LEARN_B };

const CONFIG = { name: 'A test blog', lang: 'en', learns: { title: 'Notes', intro: 'Things I found out.' } };

async function site(files, learns = {}, config = CONFIG) {
  const root = await mkdtemp(join(tmpdir(), 'blog-'));
  const postsDir = join(root, 'posts');
  const learnsDir = join(root, 'learns');
  await mkdir(postsDir);
  for (const [name, text] of Object.entries(files)) await writeFile(join(postsDir, name), text);
  if (Object.keys(learns).length > 0) {
    await mkdir(learnsDir);
    for (const [name, text] of Object.entries(learns)) await writeFile(join(learnsDir, name), text);
  }
  if (config) await writeFile(join(root, 'site.json'), JSON.stringify(config));
  return { postsDir, learnsDir, outDir: join(root, 'public'), configDir: root };
}

async function htmlPages(outDir) {
  const names = (await readdir(outDir, { recursive: true })).filter((n) => n.endsWith('.html'));
  return Promise.all(names.map((n) => readFile(join(outDir, n), 'utf8')));
}

const PUBLIC_PAGES = ['index.html', 'first-post.html', 'second-post.html', 'learns.html', 'learns/a-test-that-lied.html', '404.html'];

test('makes the home page, the post pages, the 404 and the copy of site/', async () => {
  const dirs = await site(TWO);
  assert.equal(await build(dirs), 2);
  for (const f of ['index.html', 'first-post.html', 'second-post.html', '404.html', 'style.css', 'theme.js', 'lib/post.js', 'fonts/Inconsolata.woff2']) {
    assert.ok(existsSync(join(dirs.outDir, f)), f);
  }
});

test('the home page lists the posts from the most recent', async () => {
  const dirs = await site(TWO);
  await build(dirs);
  const index = await readFile(join(dirs.outDir, 'index.html'), 'utf8');
  assert.ok(index.includes('<span class="date">2026-10-05</span> <a href="/first-post">First post</a>'));
  assert.ok(index.indexOf('First post') < index.indexOf('Second post'));
});

test('the post page has title, date and theme switch', async () => {
  const dirs = await site(TWO);
  await build(dirs);
  const page = await readFile(join(dirs.outDir, 'first-post.html'), 'utf8');
  assert.ok(page.includes('<h2>First post</h2>'));
  assert.ok(page.includes('<p class="date">2026-10-05</p>'));
  assert.ok(page.includes('<script src="/theme.js"></script>'));
  assert.ok(page.includes('<button id="theme" type="button" hidden></button>'));
});

test('the time block never reaches the pages', async () => {
  const dirs = await site(TWO);
  await build(dirs);
  for (const page of await htmlPages(dirs.outDir)) {
    for (const leak of ['started', 'finished', 'written', 'sessions', '21:14', '08:02', '86 min']) {
      assert.ok(!page.includes(leak), leak);
    }
  }
});

test('a broken time block stops the build', async () => {
  const inBody = 'Title\n\nBody.\n\n--\nstarted: 2026-10-03T21:14-05:00\na line without form\n';
  await assert.rejects(build(await site({ '2026-10-05-a.txt': inBody })), /broken time block/);
  const inTitle = 'started: 2026-10-03T21:14-05:00\n';
  await assert.rejects(build(await site({ '2026-10-05-b.txt': inTitle })), /broken time block/);
});

test('a time block with an unknown key stops the build, naming the file and the first unknown key', async () => {
  const other = 'Title\n\nBody.\n\n--\nmood: happy\nstarted: 2026-10-03T21:14-05:00\nwritten: 86 min\nsessions: 3\n';
  const dirs = await site({ ...TWO, '2026-10-05-other.txt': other });
  await mkdir(dirs.outDir);
  await writeFile(join(dirs.outDir, 'index.html'), 'the site before');
  await assert.rejects(build(dirs), { message: 'posts/2026-10-05-other.txt: unknown key "mood" in the time block (expected started, finished, written, sessions, section)' });
  assert.equal(await readFile(join(dirs.outDir, 'index.html'), 'utf8'), 'the site before');
  const learn = LEARN_B.trimEnd() + '\n\n--\nsessions: 1\nkind: learn\n';
  await assert.rejects(build(await site({}, { '2026-10-12-a-test-that-lied.txt': learn })), /^Error: learns[/]2026-10-12-a-test-that-lied\.txt: unknown key "kind" in the time block/);
});

test('any other unknown key in the time block stops the build too', async () => {
  const file = 'Title\n\nBody.\n\n--\nstarted: 2026-10-03T21:14-05:00\nweather: rain\n';
  await assert.rejects(build(await site({ '2026-10-05-a.txt': file })), /posts[/]2026-10-05-a\.txt: unknown key "weather"/);
});

test('a time block reformatted by hand stops the build', async () => {
  const lines = ['started: 2026-10-03T21:14-05:00', 'finished: 2026-10-05T08:02-05:00', 'written: 86 min', 'sessions: 3'];
  const wide = String.fromCharCode(0xff1a);
  const nel = String.fromCharCode(0x85);
  const vt = String.fromCharCode(0x0b);
  const cases = {
    quoted: '--\n' + lines.map((l) => '> ' + l).join('\n'),
    listed: '--\n' + lines.map((l) => '- ' + l).join('\n'),
    'one line': '-- ' + lines.join(' '),
    'wide colons': '--\n' + lines.map((l) => l.replace(':', wide)).join('\n'),
    'odd line end': '--' + nel + lines.join(nel),
    'vertical tab': '--' + vt + lines.join(vt),
    'other keys, no separator': ['begun: 2026-10-03T21:14-05:00', 'ended: 2026-10-05T08:02-05:00', 'typed: 86 min', 'sittings: 3'].join('\n'),
  };
  for (const [label, block] of Object.entries(cases)) {
    const file = `Title\n\nBody.\n\n${block}\n`;
    await assert.rejects(build(await site({ '2026-10-05-a.txt': file })), /broken time block/, label);
  }
});

async function siteCopy() {
  const dir = await mkdtemp(join(tmpdir(), 'blog-site-'));
  await cp('site', dir, { recursive: true });
  return dir;
}

const versionOf = async (outDir) => (await readFile(join(outDir, 'sw.js'), 'utf8')).match(/const VERSION = '([^']*)';/)?.[1];

test('the offline copy of the editor is named after the fingerprint of the files', async () => {
  const dirs = await site({});
  await build(dirs);
  assert.match(await versionOf(dirs.outDir), /^[0-9a-f]{12}$/);
  assert.ok(!(await readFile(join(dirs.outDir, 'sw.js'), 'utf8')).includes("'dev'"));
});

test('same editor files, same fingerprint; one file changed, new fingerprint', async () => {
  const siteDir = await siteCopy();
  const one = await site({});
  const two = await site({});
  const three = await site({});
  await build({ ...one, siteDir });
  await build({ ...two, siteDir });
  assert.equal(await versionOf(one.outDir), await versionOf(two.outDir));
  await writeFile(join(siteDir, 'lib', 'post.js'), (await readFile(join(siteDir, 'lib', 'post.js'), 'utf8')) + '\nconst extra = 1;\n');
  await build({ ...three, siteDir });
  assert.notEqual(await versionOf(three.outDir), await versionOf(one.outDir));
});

test('code written in a post stays text, addresses become links', async () => {
  const dirs = await site(TWO);
  await build(dirs);
  const page = await readFile(join(dirs.outDir, 'first-post.html'), 'utf8');
  assert.ok(page.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!page.includes('<script>alert(1)'));
  assert.ok(page.includes('<a href="https://example.com" rel="noopener">https://example.com</a>.'));
});

test('pages load nothing from other sites and link nowhere outside, apart from the text of a piece', async () => {
  const dirs = await site(TWO, LEARNS);
  await build(dirs);
  for (const page of await htmlPages(dirs.outDir)) {
    const frame = page.replace(/<pre>[\s\S]*?<\/pre>/g, '');
    for (const [, target] of frame.matchAll(/\ssrc="([^"]+)"/g)) assert.ok(target.startsWith('/'), target);
    for (const [, target] of frame.matchAll(/<link [^>]*href="([^"]+)"/g)) assert.ok(target.startsWith('/'), target);
    for (const [, target] of frame.matchAll(/<a [^>]*href="([^"]+)"/g)) assert.ok(target.startsWith('/'), target);
    assert.ok(!/name="author"/i.test(page));
  }
});

test('every public page asks the browser not to tell other sites where the reader comes from', async () => {
  const dirs = await site(TWO, LEARNS);
  await build(dirs);
  const names = (await readdir(dirs.outDir, { recursive: true })).map((n) => n.replace(/\\/g, '/')).filter((n) => n.endsWith('.html') && n !== 'write.html');
  for (const must of PUBLIC_PAGES) assert.ok(names.includes(must), must);
  for (const name of names) {
    const html = await readFile(join(dirs.outDir, name), 'utf8');
    const head = html.slice(0, html.indexOf('</head>'));
    assert.ok(head.includes('<meta name="referrer" content="no-referrer">'), name);
  }
});

test('every public page has the hidden "write" link in its header, after the theme switch', async () => {
  const dirs = await site(TWO, LEARNS);
  await build(dirs);
  const link = '<a id="write" href="/write" hidden>write</a>';
  const header = `<button id="theme" type="button" hidden></button>${link}</header>`;
  for (const name of PUBLIC_PAGES) {
    const html = await readFile(join(dirs.outDir, name), 'utf8');
    const top = html.slice(html.indexOf('<header>'), html.indexOf('</header>') + '</header>'.length);
    assert.ok(top.endsWith(header), name);
    assert.equal(html.split('id="write"').length, 2, name);
  }
});

test('a file without the shape of a post is skipped', async () => {
  const dirs = await site({ ...TWO, 'notes.txt': 'x' });
  assert.equal(await build(dirs), 2);
});

test('two posts with the same address stop the build', async () => {
  const dirs = await site({ '2026-10-05-a.txt': POST_B, '2026-10-01-a.txt': POST_B });
  await assert.rejects(build(dirs), /address already used/);
});

test('a post with a reserved name stops the build', async () => {
  const dirs = await site({ '2026-10-05-write.txt': POST_B });
  await assert.rejects(build(dirs), /address already used/);
});

test('a post without a section line, or with "section: post", builds', async () => {
  const tagged = 'Third post\n\nText.\n\n--\nstarted: 2026-10-06T09:00-05:00\nfinished: 2026-10-06T09:30-05:00\nwritten: 12 min\nsessions: 1\nsection: post\n';
  const dirs = await site({ ...TWO, '2026-10-06-third-post.txt': tagged });
  assert.equal(await build(dirs), 3);
  assert.ok(!(await readFile(join(dirs.outDir, 'third-post.html'), 'utf8')).includes('section'));
});

test('a file in posts/ with another section stops the build', async () => {
  for (const other of ['private', 'idea', 'learn']) {
    const file = `A thought\n\nNot for the site.\n\n--\nsection: ${other}\n`;
    await assert.rejects(build(await site({ '2026-10-05-a-thought.txt': file })), new RegExp(`section "${other}" in posts/2026-10-05-a-thought\\.txt: the folder says post`), other);
  }
});

test('same files, same result', async () => {
  const one = await site(TWO);
  const two = await site(TWO);
  await build(one);
  await build(two);
  assert.equal(await readFile(join(one.outDir, 'index.html'), 'utf8'), await readFile(join(two.outDir, 'index.html'), 'utf8'));
});

test('without posts the home page is empty but valid', async () => {
  const dirs = await site({});
  assert.equal(await build(dirs), 0);
  assert.ok((await readFile(join(dirs.outDir, 'index.html'), 'utf8')).includes('<ul class="list">'));
});

test('without the posts folder the build does not break', async () => {
  const dirs = await site({});
  assert.equal(await build({ ...dirs, postsDir: join(dirs.postsDir, 'missing') }), 0);
});

test('every name in the root of the site is reserved', async () => {
  const dirs = await site({}, LEARNS);
  await build(dirs);
  for (const name of await readdir(dirs.outDir)) {
    assert.ok(RESERVED_SLUGS.includes(parse(name).name), `${name} is missing from RESERVED_SLUGS`);
  }
});

test('the icons are only the pencil and the arrow', () => {
  assert.deepEqual(Object.keys(icons).sort(), ['ARROW', 'PENCIL']);
});

test('the icons have width and height: with an old or missing stylesheet they stay small', () => {
  for (const icon of [PENCIL, ARROW]) assert.match(icon, /^<svg [^>]*width="16" height="16"[^>]*>/);
});

test('the <title> and the header use the name from site.json', async () => {
  const dirs = await site(TWO, LEARNS);
  await build(dirs);
  const index = await readFile(join(dirs.outDir, 'index.html'), 'utf8');
  assert.ok(index.includes('<title>A test blog</title>'));
  assert.ok(index.includes('<header><h1><a href="/">A test blog</a></h1>'));
  const titles = {
    'first-post.html': 'First post - A test blog',
    'learns.html': 'Notes - A test blog',
    'learns/a-test-that-lied.html': 'A test that lied - A test blog',
    '404.html': '404 - A test blog',
  };
  for (const [name, title] of Object.entries(titles)) {
    const html = await readFile(join(dirs.outDir, name), 'utf8');
    assert.ok(html.includes(`<title>${title}</title>`), name);
    assert.ok(html.includes('<h1><a href="/">A test blog</a></h1>'), name);
  }
});

test('the name from site.json is escaped once', async () => {
  const dirs = await site(TWO, {}, { ...CONFIG, name: 'Tom & <Jerry>' });
  await build(dirs);
  const index = await readFile(join(dirs.outDir, 'index.html'), 'utf8');
  assert.ok(index.includes('<title>Tom &amp; &lt;Jerry&gt;</title>'));
  assert.ok(index.includes('<h1><a href="/">Tom &amp; &lt;Jerry&gt;</a></h1>'));
  assert.ok(!index.includes('<Jerry>'));
});

test('<html lang> comes from site.json on every public page', async () => {
  const dirs = await site(TWO, LEARNS, { ...CONFIG, lang: 'fr' });
  await build(dirs);
  for (const name of PUBLIC_PAGES) {
    const html = await readFile(join(dirs.outDir, name), 'utf8');
    assert.ok(html.includes('<!doctype html>\n<html lang="fr">\n<head>'), name);
  }
});

test('without site.json the build stops before touching public/', async () => {
  const dirs = await site(TWO, {}, null);
  await mkdir(dirs.outDir);
  await writeFile(join(dirs.outDir, 'index.html'), 'the site before');
  await assert.rejects(build(dirs), { message: `site.json: not found in ${dirs.configDir}` });
  assert.equal(await readFile(join(dirs.outDir, 'index.html'), 'utf8'), 'the site before');
});

test('a site.json with a missing field stops the build with the field name', async () => {
  const dirs = await site(TWO, {}, { name: 'A test blog', learns: CONFIG.learns });
  await assert.rejects(build(dirs), { message: 'site.json: missing "lang"' });
});

test('a relative config folder without site.json is named by its absolute path', async () => {
  const rel = join('test', 'no-such-folder');
  await assert.rejects(readSiteConfig(rel), { message: `site.json: not found in ${resolve(rel)}` });
});

async function withDemo(value, fn) {
  const before = process.env.BLOG_DEMO;
  if (value === undefined) delete process.env.BLOG_DEMO;
  else process.env.BLOG_DEMO = value;
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env.BLOG_DEMO;
    else process.env.BLOG_DEMO = before;
  }
}

const EDITOR_BODY = '<body class="write">\n<textarea id="text" hidden></textarea>\n<div id="list" hidden></div>\n<div class="bar">\n  <span id="cmds"></span>\n  <button id="theme" type="button" hidden></button>\n  <div id="status"></div>\n</div>\n</body>\n</html>\n';

test('write.html and manifest.json are not static files in site/', () => {
  assert.ok(!existsSync(join('site', 'write.html')));
  assert.ok(!existsSync(join('site', 'manifest.json')));
});

test('the build writes write.html with the name and lang from site.json', async () => {
  const dirs = await site(TWO);
  await withDemo(undefined, () => build(dirs));
  const html = await readFile(join(dirs.outDir, 'write.html'), 'utf8');
  assert.equal(html, '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="robots" content="noindex">\n'
    + '<title>A test blog</title>\n<link rel="stylesheet" href="/style.css">\n'
    + '<link rel="icon" href="/favicon.svg" type="image/svg+xml">\n<link rel="manifest" href="/manifest.json">\n'
    + '<link rel="apple-touch-icon" href="/icons/icon-512.png">\n<script src="/theme.js"></script>\n'
    + '<script type="module" src="/write.js"></script>\n</head>\n' + EDITOR_BODY);
});

test('the name in write.html is escaped once', async () => {
  const dirs = await site(TWO, {}, { ...CONFIG, name: 'Tom & <Jerry>' });
  await build(dirs);
  const html = await readFile(join(dirs.outDir, 'write.html'), 'utf8');
  assert.ok(html.includes('<title>Tom &amp; &lt;Jerry&gt;</title>'));
  assert.ok(!html.includes('<Jerry>'));
});

test('manifest.json short_name: shortName from site.json when present, else the name cut to 12 characters', async () => {
  const withShort = await site(TWO, {}, { ...CONFIG, shortName: ' Notes ' });
  await build(withShort);
  assert.equal(JSON.parse(await readFile(join(withShort.outDir, 'manifest.json'), 'utf8')).short_name, 'Notes');
  const short = await site(TWO, {}, { ...CONFIG, name: 'Tom' });
  await build(short);
  assert.equal(JSON.parse(await readFile(join(short.outDir, 'manifest.json'), 'utf8')).short_name, 'Tom');
});

test('the build writes manifest.json: name from site.json, short_name the trimmed name cut to 12 characters', async () => {
  const dirs = await site(TWO, {}, { ...CONFIG, name: '  Tom & <Jerry>  notes' });
  await build(dirs);
  assert.deepEqual(JSON.parse(await readFile(join(dirs.outDir, 'manifest.json'), 'utf8')), {
    name: '  Tom & <Jerry>  notes',
    short_name: 'Tom & <Jerry',
    start_url: '/write',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: [{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
  });
});

test('with BLOG_DEMO=1 write.html carries the demo meta; with any other value it does not', async () => {
  const meta = '<meta name="demo" content="1">';
  const demo = await site(TWO);
  await withDemo('1', () => build(demo));
  const html = await readFile(join(demo.outDir, 'write.html'), 'utf8');
  assert.ok(html.includes(`<meta name="robots" content="noindex">\n${meta}\n<title>`));
  for (const value of [undefined, '', '0', 'true', 'yes']) {
    const dirs = await site(TWO);
    await withDemo(value, () => build(dirs));
    assert.ok(!(await readFile(join(dirs.outDir, 'write.html'), 'utf8')).includes('name="demo"'), String(value));
  }
  for (const page of PUBLIC_PAGES.filter((p) => !p.startsWith('learns'))) {
    assert.ok(!(await readFile(join(demo.outDir, page), 'utf8')).includes('name="demo"'), page);
  }
});

test('the editor copy gets a new fingerprint when the name or the demo mode changes', async () => {
  const plain = await site({});
  const renamed = await site({}, {}, { ...CONFIG, name: 'Another blog' });
  const demo = await site({});
  await withDemo(undefined, () => build(plain));
  await withDemo(undefined, () => build(renamed));
  await withDemo('1', () => build(demo));
  const versions = [await versionOf(plain.outDir), await versionOf(renamed.outDir), await versionOf(demo.outDir)];
  assert.equal(new Set(versions).size, 3, versions.join(' '));
});

test('every file the service worker keeps is in public/ after the build', async () => {
  const source = await readFile('site/sw.js', 'utf8');
  const shell = [...source.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const dirs = await site(TWO);
  await build(dirs);
  for (const path of shell) {
    const file = path === '/write' ? 'write.html' : path.slice(1);
    assert.ok(existsSync(join(dirs.outDir, file)), path);
  }
});

test('node build.js with a broken site.json prints only the message and exits with 1', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'blog-cli-'));
  const out = spawnSync(process.execPath, [resolve('build.js')], { cwd: dir, encoding: 'utf8' });
  assert.equal(out.status, 1);
  assert.equal(out.stdout, '');
  assert.equal(out.stderr, `site.json: not found in ${dir}\n`);
  assert.ok(!existsSync(join(dir, 'public')));
});

test('a learn has its page at /learns/<address>, shaped like a post, without pills and without block', async () => {
  const dirs = await site(TWO, LEARNS);
  await build(dirs);
  const page = await readFile(join(dirs.outDir, 'learns', 'why-my-phone-showed-the-old-page.html'), 'utf8');
  assert.ok(page.includes('<h2>Why my phone showed the old page</h2>\n<p class="date">2026-10-19</p>\n<pre>I changed one line and nothing moved.\n\nThe copy was old.</pre>'));
  assert.ok(!page.includes('pill:') && !page.includes('Its saved copy'));
  assert.ok(existsSync(join(dirs.outDir, 'learns', 'a-test-that-lied.html')));
});

test('the home has the learns box before the posts, titled from site.json: newest first, pencil, link', async () => {
  const dirs = await site(TWO, LEARNS);
  await build(dirs);
  const index = await readFile(join(dirs.outDir, 'index.html'), 'utf8');
  assert.ok(index.includes(`<main>\n<section class="blog-box blog-learns" id="blog-learns">\n<h2 class="blog-title"><a href="/learns">Notes</a> ${PENCIL}</h2>\n<button class="blog-toggle" id="blog-learns-toggle" type="button" hidden></button>\n<ul class="blog-rotation">\n<li><a href="/learns/why-my-phone-showed-the-old-page">Why my phone showed the old page</a></li>\n<li hidden><a href="/learns/a-test-that-lied">A test that lied</a></li>\n</ul>\n</section>\n<ul class="list">`));
  assert.ok(index.includes('<script src="/learns.js" defer></script>'), 'the script rotates the box');
});

test('the learns box is there with a single learn; without learns, no box, no /learns and no script', async () => {
  const one = await site(TWO, { '2026-10-12-a-test-that-lied.txt': LEARN_B });
  await build(one);
  const index = await readFile(join(one.outDir, 'index.html'), 'utf8');
  assert.ok(index.includes('id="blog-learns"'));
  assert.ok(index.includes('<script src="/learns.js" defer></script>'));
  const none = await site(TWO);
  await build(none);
  const bare = await readFile(join(none.outDir, 'index.html'), 'utf8');
  assert.ok(!bare.includes('blog-learns'));
  assert.ok(!bare.includes('/learns.js'));
  assert.ok(bare.includes('<main>\n<ul class="list">'));
  assert.ok(!existsSync(join(none.outDir, 'learns.html')));
});

test('the /learns page: title and intro from site.json, pill, then the learns newest first', async () => {
  const dirs = await site(TWO, LEARNS);
  await build(dirs);
  const page = await readFile(join(dirs.outDir, 'learns.html'), 'utf8');
  assert.ok(page.includes('<h2 class="blog-page-title">Notes</h2>\n<p class="blog-intro">Things I found out.</p>\n<section class="pill" id="pill">'));
  assert.ok(page.includes('<ul class="list">\n<li><span class="date">2026-10-19</span> <a href="/learns/why-my-phone-showed-the-old-page">Why my phone showed the old page</a></li>\n<li><span class="date">2026-10-12</span> <a href="/learns/a-test-that-lied">A test that lied</a></li>\n</ul>'));
  assert.ok(page.indexOf('id="pill"') < page.indexOf('<ul class="list">'));
  assert.ok(page.includes('<script src="/learns.js" defer></script>'));
  assert.ok(page.includes('<title>Notes - A test blog</title>'));
});

test('the learns title and intro from site.json are escaped once', async () => {
  const dirs = await site(TWO, LEARNS, { ...CONFIG, learns: { title: 'Q & A', intro: 'Small <notes> & more' } });
  await build(dirs);
  const page = await readFile(join(dirs.outDir, 'learns.html'), 'utf8');
  assert.ok(page.includes('<h2 class="blog-page-title">Q &amp; A</h2>\n<p class="blog-intro">Small &lt;notes&gt; &amp; more</p>'));
  const index = await readFile(join(dirs.outDir, 'index.html'), 'utf8');
  assert.ok(index.includes('<a href="/learns">Q &amp; A</a>'));
});

test('piece pages and the 404 load no script beyond the theme', async () => {
  const dirs = await site(TWO, LEARNS);
  await build(dirs);
  for (const name of ['first-post.html', 'learns/a-test-that-lied.html', '404.html']) {
    const html = await readFile(join(dirs.outDir, name), 'utf8');
    assert.deepEqual([...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]), ['/theme.js'], name);
  }
});

test('the build writes only the scripts of site/ and no page has a footer', async () => {
  const dirs = await site(TWO, LEARNS);
  await build(dirs);
  const scripts = (await readdir(dirs.outDir)).filter((n) => n.endsWith('.js')).sort();
  const sources = (await readdir('site')).filter((n) => n.endsWith('.js')).sort();
  assert.deepEqual(scripts, sources);
  assert.ok(existsSync(join(dirs.outDir, 'learns.js')));
  for (const page of await htmlPages(dirs.outDir)) {
    for (const leak of ['<footer', '-foot']) {
      assert.ok(!page.toLowerCase().includes(leak), leak);
    }
  }
});

test('the pill: every question in the page, the first one visible with its answer, the link to the piece, text escaped', async () => {
  const dirs = await site(TWO, LEARNS);
  await build(dirs);
  const page = await readFile(join(dirs.outDir, 'learns.html'), 'utf8');
  assert.equal((page.match(/class="pill-item"/g) || []).length, 4);
  assert.equal((page.match(/class="pill-item" data-pill="\d+" hidden>/g) || []).length, 3);
  assert.ok(page.includes(`<h3 class="pill-title">Learning Pill</h3>\n<div class="pill-item" data-pill="0">\n<p class="pill-q">When is a green test a lie? <button class="pill-open" type="button" aria-expanded="true" aria-label="Hide answer" hidden>${ARROW}</button></p>\n<div class="pill-a">\n<p>When it checks the wrong thing.</p>\n<p class="pill-from">from <a href="/learns/a-test-that-lied">A test that lied</a></p>\n</div>\n</div>`));
  assert.ok(page.includes('<p>A new &lt;sw.js&gt; &amp; a reload.</p>'), 'the text of the pills is escaped exactly once');
  assert.ok(page.includes('<p class="pill-skip"><button id="pill-skip" type="button" hidden>skip</button></p>\n</section>'));
});

test('a learn with fewer than two pills or with a broken pill line stops the build', async () => {
  const one = 'A story\n\nBody.\n\npill: Only? | One.\n';
  await assert.rejects(build(await site({}, { '2026-10-19-a-story.txt': one })), /learns[/]2026-10-19-a-story\.txt: a learn needs at least two/);
  const broken = 'A story\n\nBody.\n\npill: Q? | A.\npill: no answer\n';
  await assert.rejects(build(await site({}, { '2026-10-19-a-story.txt': broken })), /pill line without a question or an answer: pill: no answer/);
});

test('a learn with another section stops the build', async () => {
  const file = LEARN_B.trimEnd() + '\n\n--\nsection: post\n';
  await assert.rejects(build(await site({}, { '2026-10-12-a-test-that-lied.txt': file })), /section "post" in learns[/]2026-10-12-a-test-that-lied\.txt: the folder says learn/);
});

test('a repeated learn address stops the build', async () => {
  const dirs = await site({}, { '2026-10-12-a.txt': LEARN_B, '2026-10-13-a.txt': LEARN_B });
  await assert.rejects(build(dirs), /address already used: learns[/]a/);
});

test('a learn with the address "index" stops the build: it would cover the /learns page', async () => {
  const file = 'Index\n\nA story.\n\npill: Why? | Because.\npill: How? | Like this.\n';
  await assert.rejects(build(await site({}, { '2026-10-19-index.txt': file })), /address already used: learns[/]index \(2026-10-19-index\.txt\)/);
});

test('the pill: and section: lines never reach the pages', async () => {
  const dirs = await site(TWO, LEARNS);
  await build(dirs);
  for (const page of await htmlPages(dirs.outDir)) {
    assert.ok(!/^(pill|section):/m.test(page));
    for (const leak of ['started', 'finished', '21:14', '08:02', '20 min']) assert.ok(!page.includes(leak), leak);
  }
});
