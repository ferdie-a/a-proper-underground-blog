import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDesk } from '../site/desk.js';
import { createFakeStorage } from '../fakes/storage.js';
import { newTimes, tick } from '../site/lib/post.js';

const TIMES = tick(newTimes(), Date.UTC(2026, 9, 3, 19, 14));

const keysOf = (storage) => Array.from({ length: storage.length }, (_, i) => storage.key(i)).sort();

test('the desk keeps every file, the list, the password and the open file under blog: keys', () => {
  const storage = createFakeStorage();
  const desk = createDesk(storage);
  desk.type('drafts/a.txt', 'A', TIMES);
  desk.setPosts(['posts/2026-10-03-a.txt']);
  desk.setPassword('secret');
  desk.setOpen('drafts/a.txt');
  assert.deepEqual(keysOf(storage), ['blog:file:drafts/a.txt', 'blog:open', 'blog:password', 'blog:posts']);
});

const quotedKeys = (source) => [...source.matchAll(/'([a-z]+:[a-z:-]*)'/g)].map((m) => m[1]);

test('theme.js keeps the theme under blog:theme, the closed demo note under blog:demo-note and reads the password from the desk key', async () => {
  const source = await readFile('site/theme.js', 'utf8');
  assert.deepEqual(quotedKeys(source).sort(), ['blog:demo-note', 'blog:password', 'blog:theme']);
  const storage = createFakeStorage();
  createDesk(storage).setPassword('secret');
  assert.equal(storage.getItem('blog:password'), 'secret');
});

test('learns.js keeps its choices under blog:learns: keys', async () => {
  const keys = quotedKeys(await readFile('site/learns.js', 'utf8'));
  assert.ok(keys.length >= 2, keys.join(','));
  for (const key of keys) assert.ok(key.startsWith('blog:learns:'), key);
});

test('the service worker cache is named blog-editor and only old blog-editor caches are dropped', async () => {
  const source = await readFile('site/sw.js', 'utf8');
  assert.ok(source.includes("const CACHE = 'blog-editor-' + VERSION;"));
  assert.ok(source.includes("k.startsWith('blog-editor')"));
});

test('write.js warns about another tab on the same desk key', async () => {
  const source = await readFile('site/write.js', 'utf8');
  assert.ok(source.includes("'blog:file:' + path"));
});
