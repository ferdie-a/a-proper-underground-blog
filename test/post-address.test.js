import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RESERVED_SLUGS, slugify, uniqueSlug, draftPath, postPath, parsePostPath, parseDraftPath, draftRows,
  localDate, localStamp, escapeHtml, renderBody,
  SECTIONS, FOLDER, SECTION_LABEL, isPublic, sectionOf, nameOf, plainPath, publishedPath, parsePublishedPath, withSection, fileRows,
  titleFromSlug, clipTitle,
} from '../site/lib/post.js';

test('address from the title', () => {
  assert.equal(slugify('Why I stopped copying, café'), 'why-i-stopped-copying-cafe');
  assert.equal(slugify('  Hello, World!  '), 'hello-world');
  assert.equal(slugify('C++ & Rust: 10 things'), 'c-rust-10-things');
});

test('empty title, only symbols, Cyrillic or emoji', () => {
  for (const title of ['', '   ', '!!!', 'Привет мир', '🎵🎶']) {
    assert.equal(slugify(title), 'untitled');
  }
});

test('at most 60 characters, no trailing hyphen', () => {
  const slug = slugify('word '.repeat(30));
  assert.ok(slug.length <= 60);
  assert.ok(!slug.endsWith('-'));
});

test('never two hyphens in a row: "--" separates the variants', () => {
  assert.ok(!slugify('a -- b --- c').includes('--'));
});

test('duplicates and reserved names', () => {
  assert.equal(uniqueSlug('a', []), 'a');
  assert.equal(uniqueSlug('a', ['a']), 'a-2');
  assert.equal(uniqueSlug('a', new Set(['a', 'a-2'])), 'a-3');
  assert.equal(uniqueSlug('write', RESERVED_SLUGS), 'write-2');
  assert.equal(uniqueSlug(slugify('Привет'), ['untitled']), 'untitled-2');
});

test('paths of drafts and posts', () => {
  assert.equal(draftPath('first-post'), 'drafts/first-post.txt');
  assert.equal(draftPath('first-post', 'dark-ending'), 'drafts/first-post--dark-ending.txt');
  assert.equal(postPath('2026-10-03', 'first-post'), 'posts/2026-10-03-first-post.txt');
  assert.deepEqual(parsePostPath('posts/2026-10-03-first-post.txt'), { date: '2026-10-03', slug: 'first-post' });
  assert.equal(parsePostPath('posts/notes.txt'), null);
  assert.deepEqual(parseDraftPath('drafts/first-post.txt'), { slug: 'first-post', fork: '' });
  assert.deepEqual(parseDraftPath('drafts/first-post--dark-ending.txt'), { slug: 'first-post', fork: 'dark-ending' });
  assert.equal(parseDraftPath('posts/2026-10-03-first-post.txt'), null);
});

const begun = (day) => ({ started: `2026-10-0${day}T21:14-05:00` });
const DRAFTS = [
  { path: 'drafts/a--second.txt', text: 'Alpha\n\nAnother ending.', times: begun(1) },
  { path: 'drafts/a--first.txt', text: 'Alpha, rewritten', times: begun(1) },
  { path: 'drafts/a-b.txt', text: 'A and B', times: begun(3) },
  { path: 'drafts/a.txt', text: 'Alpha\n\nBody.', times: begun(1) },
  { path: 'drafts/c--alone.txt', text: 'Gamma', times: begun(2) },
  { path: 'drafts/d.txt', text: '' },
];

test('draft list: the draft started last is on top, and variants sit under their draft', () => {
  assert.deepEqual(draftRows(DRAFTS).map((r) => [r.name, r.fork]), [
    ['a-b', false],
    ['c--alone', false],
    ['a', false], ['first', true], ['second', true],
    ['d', false],
  ]);
});

test('draft list: a variant left without its draft is a row of its own, with the full name', () => {
  const row = draftRows(DRAFTS).find((r) => r.path === 'drafts/c--alone.txt');
  assert.equal(row.name, 'c--alone');
  assert.equal(row.fork, false);
});

test('draft list: every row carries the title, that is the first line of the text', () => {
  assert.deepEqual(draftRows(DRAFTS).map((r) => r.title), ['A and B', 'Gamma', 'Alpha', 'Alpha, rewritten', 'Alpha', '']);
});

test('draft list: the instant of the start counts, not how it is written (different time zones)', () => {
  const rows = draftRows([
    { path: 'drafts/a-utc.txt', text: 'UTC', times: { started: '2026-10-03T07:30+00:00' } },
    { path: 'drafts/b-west.txt', text: 'West', times: { started: '2026-10-03T03:00-05:00' } },
  ]);
  assert.deepEqual(rows.map((r) => r.name), ['b-west', 'a-utc']);
});

test('draft list: with the same start the name decides, and drafts without a start go last', () => {
  const rows = draftRows([
    { path: 'drafts/none-b.txt', text: '' },
    { path: 'drafts/zeta.txt', text: 'Zeta', times: begun(2) },
    { path: 'drafts/none-a.txt', text: '', times: { started: null } },
    { path: 'drafts/alpha.txt', text: 'Alpha', times: begun(2) },
  ]);
  assert.deepEqual(rows.map((r) => r.name), ['alpha', 'zeta', 'none-a', 'none-b']);
});

test('draft list: every row keeps the path and the state of its file', () => {
  const rows = draftRows([{ path: 'drafts/a.txt', text: 'Alpha', pending: 'FILE', dirty: false, conflict: null }]);
  assert.equal(rows[0].path, 'drafts/a.txt');
  assert.equal(rows[0].pending, 'FILE');
});

test('date and instant follow the device', () => {
  const d = new Date(2026, 9, 3, 21, 14, 59);
  assert.equal(localDate(d), '2026-10-03');
  assert.match(localStamp(d), /^2026-10-03T21:14[+-]\d{2}:\d{2}$/);
  assert.equal(Math.floor(new Date(localStamp(d)).getTime() / 60000), Math.floor(d.getTime() / 60000));
});

test('the text is made harmless', () => {
  assert.equal(escapeHtml('<b> & "x"'), '&lt;b&gt; &amp; &quot;x&quot;');
  assert.equal(
    renderBody('<script>alert("x")</script> & co'),
    '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; co',
  );
});

test('addresses become links', () => {
  assert.equal(
    renderBody('see https://example.com/a?b=1&c=2 here'),
    'see <a href="https://example.com/a?b=1&amp;c=2" rel="noopener">https://example.com/a?b=1&amp;c=2</a> here',
  );
});

test('the closing punctuation stays out of the link', () => {
  assert.equal(
    renderBody('(see https://example.com/a).'),
    '(see <a href="https://example.com/a" rel="noopener">https://example.com/a</a>).',
  );
  assert.equal(
    renderBody('"https://example.com"'),
    '&quot;<a href="https://example.com" rel="noopener">https://example.com</a>&quot;',
  );
});

test('an & at the end of an address stays out of the link, whole', () => {
  assert.equal(
    renderBody('see http://a.com/?x=1& then'),
    'see <a href="http://a.com/?x=1" rel="noopener">http://a.com/?x=1</a>&amp; then',
  );
  assert.equal(
    renderBody('see http://a.com/?x=1&.'),
    'see <a href="http://a.com/?x=1" rel="noopener">http://a.com/?x=1</a>&amp;.',
  );
});

test('an address cannot leave its attribute', () => {
  const out = renderBody('https://example.com/"onmouseover="x');
  assert.ok(out.startsWith('<a href="https://example.com/" rel="noopener">'));
  assert.ok(!out.includes('onmouseover="'));
});

test('only http and https become links', () => {
  assert.equal(renderBody('javascript:alert(1)'), 'javascript:alert(1)');
  assert.equal(renderBody('http:// alone'), 'http:// alone');
});

test('the sections: folder, label, paths and names', () => {
  assert.deepEqual(SECTIONS, ['draft', 'idea', 'private', 'post', 'learn']);
  assert.deepEqual(FOLDER, { draft: 'drafts', idea: 'ideas', private: 'private', post: 'posts', learn: 'learns' });
  assert.deepEqual(SECTION_LABEL, { draft: 'draft', idea: 'idea', private: 'private', post: 'post', learn: 'learn' });
  assert.equal(sectionOf('drafts/a--b.txt'), 'draft');
  assert.equal(sectionOf('ideas/a.txt'), 'idea');
  assert.equal(sectionOf('private/a.txt'), 'private');
  assert.equal(sectionOf('posts/2026-10-05-a.txt'), 'post');
  assert.equal(sectionOf('learns/2026-10-19-a.txt'), 'learn');
  for (const other of ['new', 'privates/a.txt', 'idea/a.txt', 'learn/a.txt']) assert.equal(sectionOf(other), null, other);
  assert.ok(isPublic('post') && isPublic('learn') && !isPublic('private'));
  assert.equal(plainPath('idea', 'an-idea'), 'ideas/an-idea.txt');
  assert.equal(plainPath('private', 'a-thought'), 'private/a-thought.txt');
  assert.equal(publishedPath('learn', '2026-10-19', 'a'), 'learns/2026-10-19-a.txt');
  assert.deepEqual(parsePublishedPath('learns/2026-10-19-a.txt'), { section: 'learn', date: '2026-10-19', slug: 'a' });
  assert.deepEqual(parsePublishedPath('posts/2026-10-05-a.txt'), { section: 'post', date: '2026-10-05', slug: 'a' });
  assert.equal(parsePublishedPath('ideas/2026-10-05-a.txt'), null);
  assert.equal(nameOf('drafts/a--ending.txt'), 'a--ending');
  assert.equal(nameOf('posts/2026-10-05-first-post.txt'), 'first-post');
  assert.equal(nameOf('private/a-thought.txt'), 'a-thought');
  assert.deepEqual(withSection({ started: 'x' }, 'idea'), { started: 'x', section: 'idea' });
  assert.deepEqual(withSection({ started: 'x', section: 'idea' }, 'draft'), { started: 'x' });
  assert.equal(uniqueSlug('learns', RESERVED_SLUGS), 'learns-2');
});

test('the "files" list: drafts first, then ideas, private files and published pieces, each with its label', () => {
  const records = [
    { path: 'drafts/b.txt', text: 'Bee', times: begun(2) },
    { path: 'ideas/x.txt', text: 'Ex', times: begun(1) },
    { path: 'ideas/y.txt', text: 'Why', times: begun(3) },
    { path: 'private/p.txt', text: 'Pea', times: begun(1) },
    { path: 'new', text: 'sheet', times: begun(4) },
    { path: 'posts/2026-10-05-a.txt', text: 'A', times: begun(1) },
  ];
  const rows = fileRows(records, ['posts/2026-10-05-a.txt', 'learns/2026-10-19-l.txt', 'posts/2026-10-07-c.txt']);
  assert.deepEqual(rows.map((r) => [r.label, r.title]), [
    ['draft', 'Bee'],
    ['idea', 'Why'],
    ['idea', 'Ex'],
    ['private', 'Pea'],
    ['learn', 'l'],
    ['post', 'c'],
    ['post', 'A'],
  ]);
  assert.deepEqual(rows.slice(0, 2).map((r) => r.path), ['drafts/b.txt', 'ideas/y.txt']);
});

const DOTS = String.fromCharCode(8230);

test('clipping the title: up to 60 characters it stays whole, beyond it becomes 60 plus the ellipsis', () => {
  const sixty = 'x'.repeat(60);
  assert.equal(clipTitle(sixty), sixty);
  assert.equal(clipTitle('x'.repeat(61)), sixty + DOTS);
  assert.equal(clipTitle('y'.repeat(200)), 'y'.repeat(60) + DOTS);
  assert.equal(clipTitle('short'), 'short');
  assert.equal(clipTitle('abcdef', 3), 'abc' + DOTS);
});

test('the title from the address: hyphens to spaces, no capitals or accents, no date', () => {
  assert.equal(titleFromSlug('a-plain-title'), 'a plain title');
  assert.equal(titleFromSlug('a--b'), 'a b');
  assert.equal(titleFromSlug('2026'), '2026');
});

test('the "files" list: a published piece never opened takes its title from the address, and no row carries the name', () => {
  const rows = fileRows([], [
    'posts/2026-10-05-a-plain-title.txt',
    'posts/2026-10-01-a--b.txt',
    'learns/2026-10-02-2026.txt',
  ]);
  assert.deepEqual(rows, [
    { path: 'posts/2026-10-05-a-plain-title.txt', label: 'post', title: 'a plain title', fork: false },
    { path: 'learns/2026-10-02-2026.txt', label: 'learn', title: '2026', fork: false },
    { path: 'posts/2026-10-01-a--b.txt', label: 'post', title: 'a b', fork: false },
  ]);
  for (const row of rows) assert.ok(!('name' in row), row.path);
});

test('the "files" list: a published piece that is also on this device shows its real title, clipped', () => {
  const long = 'A real title that goes well beyond the sixty-character threshold of the list';
  const rows = fileRows(
    [{ path: 'posts/2026-10-05-a-plain-title.txt', text: 'A plain title\n\nBody.' },
      { path: 'learns/2026-10-06-long.txt', text: long + '\n\nBody.' }],
    ['posts/2026-10-05-a-plain-title.txt', 'learns/2026-10-06-long.txt'],
  );
  assert.deepEqual(rows.map((r) => r.title), [long.slice(0, 60) + DOTS, 'A plain title']);
});

test('the "files" list: a draft, an idea and a private file without a line of text say "(untitled)"', () => {
  const rows = fileRows([
    { path: 'drafts/d.txt', text: '' },
    { path: 'ideas/i.txt', text: '   \n\n  ' },
    { path: 'private/p.txt', text: '' },
  ], []);
  assert.deepEqual(rows, [
    { path: 'drafts/d.txt', label: 'draft', title: '(untitled)', fork: false },
    { path: 'ideas/i.txt', label: 'idea', title: '(untitled)', fork: false },
    { path: 'private/p.txt', label: 'private', title: '(untitled)', fork: false },
  ]);
});

test('the "files" list: a variant sits under its draft, with its own name apart and its title', () => {
  const rows = fileRows(DRAFTS, []);
  assert.deepEqual(rows.filter((r) => r.path.startsWith('drafts/a')), [
    { path: 'drafts/a-b.txt', label: 'draft', title: 'A and B', fork: false },
    { path: 'drafts/a.txt', label: 'draft', title: 'Alpha', fork: false },
    { path: 'drafts/a--first.txt', label: 'draft', title: 'Alpha, rewritten', fork: true, forkName: 'first' },
    { path: 'drafts/a--second.txt', label: 'draft', title: 'Alpha', fork: true, forkName: 'second' },
  ]);
  assert.deepEqual(rows.find((r) => r.path === 'drafts/c--alone.txt'), { path: 'drafts/c--alone.txt', label: 'draft', title: 'Gamma', fork: false });
  for (const row of rows) assert.ok(!('name' in row), row.path);
});

test('the "files" list: a paragraph dictated in one go is clipped at 60 characters plus the ellipsis', () => {
  const paragraph = 'word '.repeat(17) + 'end';
  const noSpaces = 'z'.repeat(200);
  const rows = fileRows([
    { path: 'ideas/i.txt', text: paragraph, times: begun(2) },
    { path: 'drafts/b.txt', text: noSpaces + '\n\nBody.', times: begun(1) },
  ], []);
  assert.equal(rows[0].title, noSpaces.slice(0, 60) + DOTS);
  assert.equal(rows[1].title.length, 61);
  assert.ok(rows[1].title.endsWith(DOTS));
  assert.equal(rows[1].title, paragraph.slice(0, 60) + DOTS);
});
