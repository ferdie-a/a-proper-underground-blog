import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDesk, NEW } from '../site/desk.js';
import { createFakeStorage } from '../fakes/storage.js';
import { newTimes, tick } from '../site/lib/post.js';

const TIMES = tick(newTimes(), Date.UTC(2026, 9, 3, 19, 14));
const A = 'drafts/a.txt';
const desk = () => createDesk(createFakeStorage());

test('keystrokes create an unsaved copy', () => {
  const d = desk();
  d.type(A, 'Title', TIMES);
  const r = d.get(A);
  assert.equal(r.text, 'Title');
  assert.equal(r.dirty, true);
  assert.equal(r.pending, null);
  assert.equal(r.sha, null);
  assert.equal(r.conflict, null);
  assert.deepEqual(r.meta, {});
});

test('"save" marks the file to upload', () => {
  const d = desk();
  d.type(A, 'Title', TIMES);
  d.save(A, 'Title', TIMES, 'FILE');
  const r = d.get(A);
  assert.equal(r.pending, 'FILE');
  assert.equal(r.dirty, false);
  assert.equal(r.text, 'Title');
});

test('after the upload the mark goes away and the sha is updated', () => {
  const d = desk();
  d.save(A, 'Title', TIMES, 'FILE');
  d.uploaded(A, 'sha-1', 'FILE');
  assert.equal(d.get(A).pending, null);
  assert.equal(d.get(A).sha, 'sha-1');
});

test('if another "save" happened in the meantime, the mark stays', () => {
  const d = desk();
  d.save(A, 'one', TIMES, 'FILE-1');
  d.save(A, 'two', TIMES, 'FILE-2');
  d.uploaded(A, 'sha-1', 'FILE-1');
  assert.equal(d.get(A).pending, 'FILE-2');
  assert.equal(d.get(A).sha, 'sha-1');
});

test('the note of "save with note" stays on the file until it is uploaded', () => {
  const d = desk();
  d.save(A, 'Title', TIMES, 'FILE', 'first version');
  assert.equal(d.get(A).message, 'first version');
  d.uploaded(A, 'sha-1', 'FILE', 'first version');
  assert.equal(d.get(A).message, null);
});

test('a "save" without a note does not make one up', () => {
  const d = desk();
  d.save(A, 'Title', TIMES, 'FILE');
  assert.equal(d.get(A).message, null);
});

test('a "save" without a note does not erase the note waiting to be uploaded', () => {
  const d = desk();
  d.save(A, 'one', TIMES, 'FILE-1', 'first version');
  d.save(A, 'two', TIMES, 'FILE-2');
  assert.equal(d.get(A).message, 'first version');
  d.save(A, 'three', TIMES, 'FILE-3', 'second version');
  assert.equal(d.get(A).message, 'second version');
});

test('a note already uploaded is not repeated on the next save', () => {
  const d = desk();
  d.save(A, 'one', TIMES, 'FILE-1', 'first version');
  d.save(A, 'two', TIMES, 'FILE-2');
  d.uploaded(A, 'sha-1', 'FILE-1', 'first version');
  assert.equal(d.get(A).pending, 'FILE-2');
  assert.equal(d.get(A).message, null);
});

test('a note newer than the uploaded one stays', () => {
  const d = desk();
  d.save(A, 'one', TIMES, 'FILE-1', 'first version');
  d.save(A, 'two', TIMES, 'FILE-2', 'second version');
  d.uploaded(A, 'sha-1', 'FILE-1', 'first version');
  assert.equal(d.get(A).pending, 'FILE-2');
  assert.equal(d.get(A).message, 'second version');
});

test('the repo version arrives without a note', () => {
  const d = desk();
  d.save(A, 'old', TIMES, 'FILE', 'first version');
  d.fromRepo(A, 'Title\n\nBody.\n', 'sha-2', { force: true });
  assert.equal(d.get(A).message, null);
});

test('the repo version replaces the local copy', () => {
  const d = desk();
  d.save(A, 'old', TIMES, 'FILE');
  d.setConflict(A, 'changed');
  d.fromRepo(A, 'Title\n\nBody.\n\n--\nstarted: 2026-10-03T21:14-05:00\nwritten: 6 min\nsessions: 2\n', 'sha-2', { force: true });
  const r = d.get(A);
  assert.equal(r.text, 'Title\n\nBody.');
  assert.equal(r.times.sessions, 2);
  assert.equal(r.sha, 'sha-2');
  assert.equal(r.pending, null);
  assert.equal(r.dirty, false);
  assert.equal(r.conflict, null);
});

test('the repo version does not touch a copy with pending work, unless asked to', () => {
  const d = desk();
  const file = 'Remote\n\nText from the repo.\n';
  d.type(A, 'still typing', TIMES);
  assert.equal(d.fromRepo(A, file, 'sha-2'), false);
  assert.equal(d.get(A).text, 'still typing');
  d.save(A, 'saved here', TIMES, 'FILE');
  assert.equal(d.fromRepo(A, file, 'sha-2'), false);
  assert.equal(d.get(A).pending, 'FILE');
  assert.equal(d.fromRepo(A, file, 'sha-2', { force: true }), true);
  assert.equal(d.get(A).text, 'Remote\n\nText from the repo.');
  assert.equal(d.fromRepo('drafts/fresh.txt', file, 'sha-3'), true);
});

test('the list holds only the files, in order, with their path', () => {
  const d = desk();
  d.setPassword('x');
  d.setPosts(['posts/2026-10-03-a.txt']);
  d.type('drafts/b.txt', 'b', TIMES);
  d.type(A, 'a', TIMES);
  assert.deepEqual(d.list().map((r) => r.path), [A, 'drafts/b.txt']);
  assert.equal(d.list()[0].text, 'a');
});

test('the new sheet lives under a name of its own and is never to upload', () => {
  const d = desk();
  d.type(NEW, 'a note', TIMES);
  assert.deepEqual(d.list().map((r) => r.path), [NEW]);
  assert.equal(d.pendingCount(), 0);
});

test('counts the files to upload', () => {
  const d = desk();
  d.save(A, 'a', TIMES, 'FILE');
  d.save('drafts/b.txt', 'b', TIMES, 'FILE');
  d.type('drafts/c.txt', 'c', TIMES);
  assert.equal(d.pendingCount(), 2);
});

test('sets and clears a conflict', () => {
  const d = desk();
  d.save(A, 'a', TIMES, 'FILE');
  d.setConflict(A, 'gone');
  assert.equal(d.get(A).conflict, 'gone');
  d.setConflict(A, null);
  assert.equal(d.get(A).conflict, null);
});

test('remembers the password, the list of posts and the last open file', () => {
  const d = desk();
  assert.equal(d.getPassword(), '');
  assert.deepEqual(d.getPosts(), []);
  assert.equal(d.getOpen(), NEW);
  d.setPassword('secret');
  d.setPosts(['posts/2026-10-03-a.txt']);
  d.setOpen(A);
  assert.equal(d.getPassword(), 'secret');
  assert.deepEqual(d.getPosts(), ['posts/2026-10-03-a.txt']);
  assert.equal(d.getOpen(), A);
});

test('"sign out" clears copies, password and list, but not the theme', () => {
  const storage = createFakeStorage();
  const d = createDesk(storage);
  storage.setItem('blog:theme', 'dark');
  d.setPassword('secret');
  d.setPosts(['posts/2026-10-03-a.txt']);
  d.setOpen(A);
  d.type(A, 'a', TIMES);
  d.clear();
  assert.deepEqual(d.list(), []);
  assert.equal(d.getPassword(), '');
  assert.deepEqual(d.getPosts(), []);
  assert.equal(d.getOpen(), NEW);
  assert.equal(storage.getItem('blog:theme'), 'dark');
});

test('storage full: a clear error, and the previous copy stays', () => {
  const storage = createFakeStorage();
  const d = createDesk(storage);
  d.type(A, 'before', TIMES);
  storage.full = true;
  assert.throws(() => d.type(A, 'after', TIMES), /browser storage full/);
  assert.equal(d.get(A).text, 'before');
});

test('a file that does not exist: no error and no made-up copy', () => {
  const d = desk();
  assert.equal(d.get(A), null);
  d.uploaded(A, 'sha', 'FILE');
  d.setConflict(A, 'changed');
  d.remove(A);
  assert.equal(d.get(A), null);
});
