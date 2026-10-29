import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDesk } from '../site/desk.js';
import { createSync, doorClient } from '../site/sync.js';
import { handle } from '../server/door.js';
import { build } from '../build.js';
import { createFakeGithub } from '../fakes/github.js';
import { createFakeStorage } from '../fakes/storage.js';
import { newTimes, tick, fileFromRecord, parsePost, unknownKey } from '../site/lib/post.js';

const ENV = { BLOG_PASSWORD: 'a-test-password-at-least-thirty-two-characters-long', GITHUB_TOKEN: 't', GITHUB_REPO: 'someone/blog' };
const A = 'drafts/a.txt';
const B = 'drafts/b.txt';

function device(github, password = ENV.BLOG_PASSWORD) {
  const net = { offline: false, budget: Infinity };
  const desk = createDesk(createFakeStorage());
  desk.setPassword(password);
  const fetchImpl = async (url, init) => {
    if (net.offline || net.budget-- <= 0) throw new TypeError('fetch failed');
    return handle(new Request('http://localhost' + url, init), { env: ENV, fetch: github.fetch, failDelayMs: 0 });
  };
  const door = doorClient(() => desk.getPassword(), fetchImpl);
  const sync = createSync({ desk, door });
  function write(path, text, message) {
    const old = desk.get(path);
    const times = tick(old?.times || newTimes(), Date.UTC(2026, 9, 3, 19, 14));
    desk.save(path, text, times, fileFromRecord({ text, times, meta: old?.meta || {} }), message);
  }
  return { desk, sync, door, net, write };
}

function onRepo(github, path) {
  const branch = /^(posts|learns)[/]/.test(path) ? 'main' : 'drafts';
  const raw = github.branches[branch].get(path);
  return raw === undefined ? null : parsePost(raw);
}

const commitsOf = (github, path) => github.commits.filter((c) => c.path === path);

const PILLS = '\n\npill: Why? | Because.\npill: How? | Like this.';
const NOW = new Date(2026, 9, 5, 8, 2);
async function openOn(dev, path) {
  const found = await dev.door('read', { path });
  dev.desk.fromRepo(path, found.content, found.sha);
}

test('"save" and then sync: the draft goes up to the drafts branch', async () => {
  const github = createFakeGithub();
  const laptop = device(github);
  laptop.write(A, 'Title\n\nBody.');
  assert.deepEqual(await laptop.sync.run(), { ok: true });
  assert.equal(onRepo(github, A).body, 'Body.');
  assert.equal(laptop.desk.get(A).pending, null);
  assert.ok(laptop.desk.get(A).sha);
});

test('the first round downloads every draft and the list of posts', async () => {
  const github = createFakeGithub();
  const laptop = device(github);
  laptop.write(A, 'Draft\n\nOne.');
  await laptop.sync.run();
  await laptop.door('write', { path: 'posts/2026-10-01-x.txt', content: 'X\n' });
  const phone = device(github);
  await phone.sync.run();
  assert.equal(phone.desk.get(A).text, 'Draft\n\nOne.');
  assert.deepEqual(phone.desk.getPosts(), ['posts/2026-10-01-x.txt']);
});

test('a second round does not read again what did not change', async () => {
  const github = createFakeGithub();
  const laptop = device(github);
  laptop.write(A, 'Draft');
  await laptop.sync.run();
  const reads = () => github.state.calls.filter((c) => c.startsWith('GET') && c.includes('/contents/drafts/a.txt')).length;
  const before = reads();
  await laptop.sync.run();
  assert.equal(reads(), before);
});

test('from the laptop to the phone and back', async () => {
  const github = createFakeGithub();
  const laptop = device(github);
  const phone = device(github);
  laptop.write(A, 'Draft\n\nWritten on the laptop.');
  await laptop.sync.run();
  await phone.sync.run();
  assert.equal(phone.desk.get(A).text, 'Draft\n\nWritten on the laptop.');
  phone.write(A, 'Draft\n\nGoing on from the phone.');
  await phone.sync.run();
  await laptop.sync.run();
  assert.equal(laptop.desk.get(A).text, 'Draft\n\nGoing on from the phone.');
  assert.equal(laptop.desk.get(A).conflict, null);
});

test('offline the round fails with status 0 and the mark stays', async () => {
  const github = createFakeGithub();
  const phone = device(github);
  phone.net.offline = true;
  phone.write(A, 'On the train');
  const out = await phone.sync.run();
  assert.equal(out.ok, false);
  assert.equal(out.status, 0);
  assert.equal(phone.desk.pendingCount(), 1);
});

test('several saves offline become a single commit', async () => {
  const github = createFakeGithub();
  const phone = device(github);
  phone.net.offline = true;
  phone.write(A, 'one');
  phone.write(A, 'two');
  phone.write(A, 'three');
  await phone.sync.run();
  phone.net.offline = false;
  assert.deepEqual(await phone.sync.run(), { ok: true });
  assert.equal(commitsOf(github, A).length, 1);
  assert.equal(onRepo(github, A).title, 'three');
});

test('the network dropping halfway leaves the mark on the files that did not go up', async () => {
  const github = createFakeGithub();
  const phone = device(github);
  phone.write(A, 'a');
  phone.write(B, 'b');
  phone.net.budget = 2;
  const out = await phone.sync.run();
  assert.equal(out.status, 0);
  assert.equal(phone.desk.get(A).pending, null);
  assert.notEqual(phone.desk.get(B).pending, null);
  phone.net.budget = Infinity;
  await phone.sync.run();
  assert.equal(onRepo(github, B).title, 'b');
  assert.equal(phone.desk.pendingCount(), 0);
});

test('the note of "save with note" becomes the commit message', async () => {
  const github = createFakeGithub();
  const laptop = device(github);
  laptop.write(A, 'Draft\n\nOne.', 'first version');
  await laptop.sync.run();
  assert.deepEqual(commitsOf(github, A).map((c) => c.message), ['first version']);
  assert.equal(laptop.desk.get(A).message, null);
});

test('without a note the commit message is the default one', async () => {
  const github = createFakeGithub();
  const laptop = device(github);
  laptop.write(A, 'Draft\n\nOne.');
  await laptop.sync.run();
  assert.deepEqual(commitsOf(github, A).map((c) => c.message), ['save drafts/a.txt']);
});

test('a note is good for one commit only: the next "save" goes back to the default message', async () => {
  const github = createFakeGithub();
  const laptop = device(github);
  laptop.write(A, 'Draft\n\nOne.', 'first version');
  await laptop.sync.run();
  laptop.write(A, 'Draft\n\nTwo.');
  await laptop.sync.run();
  assert.deepEqual(commitsOf(github, A).map((c) => c.message), ['save drafts/a.txt', 'first version']);
});

test('several saves offline: a single commit, with the last note', async () => {
  const github = createFakeGithub();
  const phone = device(github);
  phone.net.offline = true;
  phone.write(A, 'one', 'first version');
  phone.write(A, 'two', 'second version');
  phone.write(A, 'three');
  await phone.sync.run();
  phone.net.offline = false;
  assert.deepEqual(await phone.sync.run(), { ok: true });
  assert.deepEqual(commitsOf(github, A).map((c) => c.message), ['second version']);
  assert.equal(onRepo(github, A).title, 'three');
});

async function conflict(note) {
  const github = createFakeGithub();
  const laptop = device(github);
  const phone = device(github);
  laptop.write(A, 'Draft\n\nFirst version.');
  await laptop.sync.run();
  await phone.sync.run();
  laptop.write(A, 'Draft\n\nLaptop version.');
  await laptop.sync.run();
  phone.write(A, 'Draft\n\nPhone version.', note);
  phone.write(B, 'Other\n\nNo problems.');
  await phone.sync.run();
  return { github, laptop, phone };
}

test('the same draft changed on two devices: conflict, and nothing is overwritten', async () => {
  const { github, phone } = await conflict();
  assert.equal(phone.desk.get(A).conflict, 'changed');
  assert.notEqual(phone.desk.get(A).pending, null);
  assert.equal(onRepo(github, A).body, 'Laptop version.');
});

test('a conflict does not stop the other files', async () => {
  const { github, phone } = await conflict();
  assert.equal(onRepo(github, B).body, 'No problems.');
  assert.equal(phone.desk.get(B).pending, null);
});

test('"keep mine": my version replaces the one on the repo', async () => {
  const { github, phone } = await conflict();
  await phone.sync.resolve(A, 'mine');
  assert.equal(onRepo(github, A).body, 'Phone version.');
  assert.equal(phone.desk.get(A).conflict, null);
  assert.equal(phone.desk.get(A).pending, null);
  assert.equal(commitsOf(github, A).length, 3);
});

test('"keep the other": the repo version comes back', async () => {
  const { github, phone } = await conflict();
  await phone.sync.resolve(A, 'theirs');
  assert.equal(phone.desk.get(A).text, 'Draft\n\nLaptop version.');
  assert.equal(phone.desk.get(A).conflict, null);
  assert.equal(phone.desk.get(A).pending, null);
  assert.equal(onRepo(github, A).body, 'Laptop version.');
});

test('"make it a variant": mine goes up under another name, the original goes back to the repo version', async () => {
  const { github, phone } = await conflict();
  const forked = 'drafts/a--from-the-phone.txt';
  await phone.sync.resolve(A, 'fork', forked);
  assert.equal(onRepo(github, forked).body, 'Phone version.');
  assert.equal(onRepo(github, A).body, 'Laptop version.');
  assert.equal(phone.desk.get(A).text, 'Draft\n\nLaptop version.');
  assert.equal(phone.desk.get(forked).text, 'Draft\n\nPhone version.');
  assert.equal(phone.desk.get(forked).pending, null);
  assert.ok(phone.desk.get(forked).sha);
});

test('a save with a note that ends in a conflict: the note waits, and "keep mine" goes up with it', async () => {
  const { github, phone } = await conflict('rewritten on the train');
  assert.equal(phone.desk.get(A).message, 'rewritten on the train');
  await phone.sync.resolve(A, 'mine');
  assert.equal(commitsOf(github, A)[0].message, 'rewritten on the train');
  assert.equal(phone.desk.get(A).message, null);
});

test('a save with a note that ends in a conflict: "make it a variant" carries the note to the variant', async () => {
  const { github, phone } = await conflict('rewritten on the train');
  const forked = 'drafts/a--from-the-phone.txt';
  await phone.sync.resolve(A, 'fork', forked);
  assert.equal(commitsOf(github, forked)[0].message, 'rewritten on the train');
  assert.equal(phone.desk.get(forked).message, null);
  assert.equal(phone.desk.get(A).message, null);
});

test('unsaved keystrokes are not touched by the download', async () => {
  const github = createFakeGithub();
  const laptop = device(github);
  const phone = device(github);
  laptop.write(A, 'one');
  await laptop.sync.run();
  await phone.sync.run();
  phone.desk.type(A, 'still typing', newTimes());
  laptop.write(A, 'two');
  await laptop.sync.run();
  await phone.sync.run();
  assert.equal(phone.desk.get(A).text, 'still typing');
  assert.equal(phone.desk.get(A).conflict, null);
  phone.write(A, 'still typing');
  await phone.sync.run();
  assert.equal(phone.desk.get(A).conflict, 'changed');
});

test('typing while the download is running keeps the typed text', async () => {
  const github = createFakeGithub();
  const laptop = device(github);
  const phone = device(github);
  laptop.write(A, 'one');
  await laptop.sync.run();
  await phone.sync.run();
  laptop.write(A, 'two');
  await laptop.sync.run();
  const slowDoor = async (action, params) => {
    const out = await phone.door(action, params);
    if (action === 'read') phone.desk.type(A, 'still typing', newTimes());
    return out;
  };
  await createSync({ desk: phone.desk, door: slowDoor }).run();
  assert.equal(phone.desk.get(A).text, 'still typing');
  assert.equal(phone.desk.get(A).dirty, true);
});

test('a new draft with a name that already exists on the repo: conflict', async () => {
  const github = createFakeGithub();
  const laptop = device(github);
  const phone = device(github);
  laptop.write(A, 'From the laptop');
  await laptop.sync.run();
  phone.write(A, 'From the phone');
  await phone.sync.run();
  assert.equal(phone.desk.get(A).conflict, 'changed');
  assert.equal(onRepo(github, A).title, 'From the laptop');
});

async function gone() {
  const github = createFakeGithub();
  const laptop = device(github);
  const phone = device(github);
  laptop.write(A, 'Draft');
  await laptop.sync.run();
  await phone.sync.run();
  await laptop.door('delete', { path: A, sha: laptop.desk.get(A).sha });
  return { github, laptop, phone };
}

test('a draft removed elsewhere and changed here: "gone" conflict, then "upload again as draft"', async () => {
  const { github, phone } = await gone();
  phone.write(A, 'Draft, continued');
  await phone.sync.run();
  assert.equal(phone.desk.get(A).conflict, 'gone');
  assert.equal(onRepo(github, A), null);
  await phone.sync.resolve(A, 'reupload');
  assert.equal(onRepo(github, A).title, 'Draft, continued');
  assert.equal(phone.desk.get(A).conflict, null);
  assert.equal(phone.desk.get(A).pending, null);
});

test('a draft removed elsewhere and saved here with a note: "upload again as draft" goes up with the note', async () => {
  const { github, phone } = await gone();
  phone.write(A, 'Draft, continued', 'picked up on the phone');
  await phone.sync.run();
  await phone.sync.resolve(A, 'reupload');
  assert.equal(commitsOf(github, A)[0].message, 'picked up on the phone');
  assert.equal(phone.desk.get(A).message, null);
});

test('a draft removed elsewhere and changed here: "discard"', async () => {
  const { github, phone } = await gone();
  phone.write(A, 'Draft, continued');
  await phone.sync.run();
  await phone.sync.resolve(A, 'discard');
  assert.equal(phone.desk.get(A), null);
  assert.equal(onRepo(github, A), null);
});

test('a draft removed elsewhere and untouched here: it leaves the desk', async () => {
  const { phone } = await gone();
  await phone.sync.run();
  assert.equal(phone.desk.get(A), null);
});

test('a draft that never went up is not removed from the desk', async () => {
  const github = createFakeGithub();
  const phone = device(github);
  phone.desk.type(A, 'just started', newTimes());
  await phone.sync.run();
  assert.equal(phone.desk.get(A).text, 'just started');
});

test('"delete" on an uploaded draft: it leaves the repo and the desk', async () => {
  const github = createFakeGithub();
  const laptop = device(github);
  laptop.write(A, 'Draft');
  await laptop.sync.run();
  await laptop.sync.remove(A);
  assert.equal(onRepo(github, A), null);
  assert.equal(laptop.desk.get(A), null);
  assert.equal(commitsOf(github, A)[0].message, 'delete drafts/a.txt');
});

test('"delete" on a draft that never went up: the desk is enough, even offline', async () => {
  const github = createFakeGithub();
  const phone = device(github);
  phone.net.offline = true;
  phone.write(A, 'Never uploaded');
  await phone.sync.remove(A);
  assert.equal(phone.desk.get(A), null);
  assert.equal(github.state.calls.length, 0);
});

test('"delete" offline on an uploaded draft: error, and the copy stays', async () => {
  const github = createFakeGithub();
  const phone = device(github);
  phone.write(A, 'Draft');
  await phone.sync.run();
  phone.net.offline = true;
  await assert.rejects(phone.sync.remove(A), (e) => e.status === 0);
  assert.equal(phone.desk.get(A).text, 'Draft');
  assert.ok(onRepo(github, A));
});

test('"delete" on a draft another device changed: refused, and nothing is deleted', async () => {
  const github = createFakeGithub();
  const laptop = device(github);
  const phone = device(github);
  laptop.write(A, 'Draft\n\nOld version.');
  await laptop.sync.run();
  await phone.sync.run();
  phone.write(A, 'Draft\n\nNew version.');
  await phone.sync.run();
  await assert.rejects(laptop.sync.remove(A), (e) => e.status === 409);
  assert.equal(onRepo(github, A).body, 'New version.');
  assert.ok(laptop.desk.get(A));
});

test('"delete" on a draft changed elsewhere and with unsaved keystrokes: the round leaves it alone, it must be saved first', async () => {
  const github = createFakeGithub();
  const laptop = device(github);
  const phone = device(github);
  laptop.write(A, 'Draft\n\nOld version.');
  await laptop.sync.run();
  await phone.sync.run();
  phone.write(A, 'Draft\n\nNew version.');
  await phone.sync.run();
  laptop.desk.type(A, 'Draft\n\nOld version, with one more keystroke.', newTimes());
  await assert.rejects(laptop.sync.remove(A), (e) => e.status === 409);
  assert.deepEqual(await laptop.sync.run(), { ok: true });
  assert.equal(laptop.desk.get(A).text, 'Draft\n\nOld version, with one more keystroke.');
  assert.equal(laptop.desk.get(A).conflict, null);
  laptop.write(A, 'Draft\n\nOld version, with one more keystroke.');
  await laptop.sync.run();
  assert.equal(laptop.desk.get(A).conflict, 'changed');
  assert.equal(onRepo(github, A).body, 'New version.');
});

test('"delete" on a draft no longer on the repo: it leaves the desk', async () => {
  const { github, phone } = await gone();
  await phone.sync.remove(A);
  assert.equal(phone.desk.get(A), null);
  assert.equal(onRepo(github, A), null);
});

test('"delete" also throws away the work of that draft not uploaded yet', async () => {
  const github = createFakeGithub();
  const laptop = device(github);
  laptop.write(A, 'Draft');
  await laptop.sync.run();
  laptop.net.offline = true;
  laptop.write(A, 'Draft\n\nA save that is waiting.');
  laptop.net.offline = false;
  await laptop.sync.remove(A);
  assert.equal(laptop.desk.get(A), null);
  assert.equal(onRepo(github, A), null);
  assert.equal(laptop.desk.pendingCount(), 0);
});

test('"delete" on a draft leaves its variants', async () => {
  const github = createFakeGithub();
  const laptop = device(github);
  const forked = 'drafts/a--ending.txt';
  laptop.write(A, 'Draft');
  laptop.write(forked, 'Draft\n\nAnother ending.');
  await laptop.sync.run();
  await laptop.sync.remove(A);
  assert.equal(onRepo(github, forked).body, 'Another ending.');
  assert.ok(laptop.desk.get(forked));
});

test('"delete" works only on drafts and variants: a post is refused', async () => {
  const github = createFakeGithub();
  const laptop = device(github);
  const post = 'posts/2026-10-01-x.txt';
  const written = await laptop.door('write', { path: post, content: 'X\n\nText.\n' });
  laptop.desk.fromRepo(post, 'X\n\nText.\n', written.sha);
  await assert.rejects(laptop.sync.remove(post), (e) => /only drafts/.test(e.error));
  assert.ok(onRepo(github, post));
  assert.ok(laptop.desk.get(post));
});

test('"delete" waits for a running sync to end: meanwhile it is refused', async () => {
  const github = createFakeGithub();
  const laptop = device(github);
  laptop.write(A, 'Draft');
  const running = laptop.sync.run();
  await assert.rejects(laptop.sync.remove(A), (e) => /sync in progress/.test(e.error));
  await running;
  assert.ok(onRepo(github, A));
  await laptop.sync.remove(A);
  assert.equal(onRepo(github, A), null);
});

test('a draft deleted on one device leaves the other one too, at the next round', async () => {
  const github = createFakeGithub();
  const laptop = device(github);
  const phone = device(github);
  laptop.write(A, 'Draft');
  await laptop.sync.run();
  await phone.sync.run();
  await laptop.sync.remove(A);
  await phone.sync.run();
  assert.equal(phone.desk.get(A), null);
});

test('publishing: the post is born on the main branch with "finished", the draft goes away', async () => {
  const github = createFakeGithub();
  const laptop = device(github);
  laptop.write('drafts/working-draft.txt', 'First post\n\nBody.');
  await laptop.sync.run();
  const out = await laptop.sync.publish('drafts/working-draft.txt', new Date(2026, 9, 5, 8, 2));
  assert.deepEqual(out, { slug: 'first-post', path: 'posts/2026-10-05-first-post.txt' });
  const post = onRepo(github, out.path);
  assert.equal(post.body, 'Body.');
  assert.match(post.meta.finished, /^2026-10-05T08:02[+-]\d{2}:\d{2}$/);
  assert.ok(post.meta.started);
  assert.equal(onRepo(github, 'drafts/working-draft.txt'), null);
  assert.equal(laptop.desk.get('drafts/working-draft.txt'), null);
});

test('equal titles give different addresses; a reserved title is moved aside', async () => {
  const github = createFakeGithub();
  const laptop = device(github);
  const now = new Date(2026, 9, 5, 8, 2);
  laptop.write(A, 'First post');
  laptop.write(B, 'First post\n\nAnother text.');
  laptop.write('drafts/c.txt', 'Write');
  await laptop.sync.run();
  assert.equal((await laptop.sync.publish(A, now)).slug, 'first-post');
  assert.equal((await laptop.sync.publish(B, now)).slug, 'first-post-2');
  assert.equal((await laptop.sync.publish('drafts/c.txt', now)).slug, 'write-2');
});

test('a draft that has not gone up yet is not published', async () => {
  const github = createFakeGithub();
  const laptop = device(github);
  laptop.write(A, 'First post');
  await assert.rejects(laptop.sync.publish(A), (e) => /must be uploaded first/.test(e.error));
  assert.equal(onRepo(github, 'posts/2026-10-05-first-post.txt'), null);
});

test('a text holding lines of the time block is not published', async () => {
  const github = createFakeGithub();
  const laptop = device(github);
  laptop.write(A, 'Title\n\nBody.\n\nstarted: 2026-10-03T21:14-05:00');
  await laptop.sync.run();
  await assert.rejects(laptop.sync.publish(A), (e) => /time block/.test(e.error));
  assert.equal(github.branches.main.size, 0);
  assert.ok(laptop.desk.get(A));
});

test('wrong password: the round answers 401', async () => {
  const out = await device(createFakeGithub(), 'wrong').sync.run();
  assert.equal(out.ok, false);
  assert.equal(out.status, 401);
});

test('a password with non-ASCII characters is wrong, not a network failure', async () => {
  const out = await device(createFakeGithub(), 'pässwörd').sync.run();
  assert.equal(out.status, 401);
});

function during(dev, action, effect) {
  let done = false;
  const door = async (a, params) => {
    const out = await dev.door(a, params);
    if (a === action && !done) { done = true; effect(); }
    return out;
  };
  return createSync({ desk: dev.desk, door });
}

test('publishing does not throw away what is typed while publishing is under way', async () => {
  const github = createFakeGithub();
  const laptop = device(github);
  laptop.write(A, 'First post\n\nBody.');
  await laptop.sync.run();
  const sync = during(laptop, 'delete', () => laptop.desk.type(A, 'First post\n\nBody. And one more line.', newTimes()));
  const out = await sync.publish(A, new Date(2026, 9, 5, 8, 2));
  assert.equal(onRepo(github, out.path).body, 'Body.');
  assert.equal(laptop.desk.get(A).text, 'First post\n\nBody. And one more line.');
  assert.equal(laptop.desk.get(A).dirty, true);
});

test('a draft another device changed is not published', async () => {
  const github = createFakeGithub();
  const laptop = device(github);
  const phone = device(github);
  laptop.write(A, 'First post\n\nOld version.');
  await laptop.sync.run();
  await phone.sync.run();
  phone.write(A, 'First post\n\nNew version.');
  await phone.sync.run();
  await assert.rejects(laptop.sync.publish(A), (e) => /changed elsewhere/.test(e.error));
  assert.equal(github.branches.main.size, 0);
  assert.ok(laptop.desk.get(A));
});

test('"keep mine" does not erase a save made while the choice was on its way', async () => {
  const { github, phone } = await conflict();
  const sync = during(phone, 'read', () => phone.write(A, 'Draft\n\nEven newer.'));
  await sync.resolve(A, 'mine');
  assert.equal(onRepo(github, A).body, 'Phone version.');
  assert.equal(phone.desk.get(A).text, 'Draft\n\nEven newer.');
  assert.notEqual(phone.desk.get(A).pending, null);
  assert.equal(phone.desk.get(A).conflict, null);
  await phone.sync.run();
  assert.equal(onRepo(github, A).body, 'Even newer.');
});

test('"make it a variant" uses up the note: it is not repeated on a save made while the choice was on its way', async () => {
  const { github, phone } = await conflict('rewritten on the train');
  const forked = 'drafts/a--from-the-phone.txt';
  const sync = during(phone, 'write', () => phone.write(A, 'Draft\n\nEven newer.'));
  await sync.resolve(A, 'fork', forked);
  assert.equal(commitsOf(github, forked)[0].message, 'rewritten on the train');
  assert.equal(phone.desk.get(A).text, 'Draft\n\nEven newer.');
  assert.equal(phone.desk.get(A).message, null);
});

test('"keep the other" does not throw away what is typed while the choice is on its way', async () => {
  const { phone } = await conflict();
  const sync = during(phone, 'read', () => phone.desk.type(A, 'Draft\n\nStill typing.', newTimes()));
  await sync.resolve(A, 'theirs');
  assert.equal(phone.desk.get(A).text, 'Draft\n\nStill typing.');
  assert.equal(phone.desk.get(A).conflict, 'changed');
});

test('a file the door refuses does not stop the others', async () => {
  const github = createFakeGithub();
  const phone = device(github);
  phone.desk.save(A, 'too long', newTimes(), 'x'.repeat(500 * 1024 + 1));
  phone.write(B, 'Normal');
  const out = await phone.sync.run();
  assert.equal(out.ok, false);
  assert.equal(out.status, 400);
  assert.equal(onRepo(github, B).title, 'Normal');
  assert.notEqual(phone.desk.get(A).pending, null);
});

test('resolving a conflict on a file that is gone gives a readable error', async () => {
  const phone = device(createFakeGithub());
  await assert.rejects(phone.sync.resolve(A, 'mine'), (e) => /no longer on this device/.test(e.error));
});

test('"make it a variant" does not overwrite a draft that already has that name', async () => {
  const { phone } = await conflict();
  await assert.rejects(phone.sync.resolve(A, 'fork', B), (e) => /already used/.test(e.error));
  assert.equal(phone.desk.get(B).text, 'Other\n\nNo problems.');
});

test('pressing "publish" again after a half-done publish does not make a duplicate', async () => {
  const github = createFakeGithub();
  const laptop = device(github);
  const now = new Date(2026, 9, 5, 8, 2);
  laptop.write(A, 'First post\n\nBody.');
  await laptop.sync.run();
  const failing = async (action, params) => {
    if (action === 'delete') throw { status: 502, error: 'GitHub not reachable' };
    return laptop.door(action, params);
  };
  await createSync({ desk: laptop.desk, door: failing }).publish(A, now);
  assert.ok(onRepo(github, A));
  await laptop.sync.run();
  const again = await laptop.sync.publish(A, now);
  assert.deepEqual(again, { slug: 'first-post', path: 'posts/2026-10-05-first-post.txt' });
  assert.equal(github.branches.main.size, 1);
  assert.equal(onRepo(github, A), null);
});

test('only drafts are published', async () => {
  const github = createFakeGithub();
  const laptop = device(github);
  const post = 'posts/2026-10-01-x.txt';
  const written = await laptop.door('write', { path: post, content: 'X\n\nText.\n' });
  laptop.desk.fromRepo(post, 'X\n\nText.\n', written.sha);
  await assert.rejects(laptop.sync.publish(post), (e) => /only drafts/.test(e.error));
  assert.equal(github.branches.main.size, 1);
});

test('ideas and private files download like drafts; the list of published pieces has posts and learns', async () => {
  const github = createFakeGithub();
  const laptop = device(github);
  laptop.write('ideas/an-idea.txt', 'An idea\n\nDictated on the train.');
  laptop.write('private/a-thought.txt', 'A thought');
  await laptop.sync.run();
  await laptop.door('write', { path: 'posts/2026-10-01-x.txt', content: 'X\n' });
  await laptop.door('write', { path: 'learns/2026-10-02-y.txt', content: 'Y\n' });
  const phone = device(github);
  await phone.sync.run();
  assert.equal(phone.desk.get('ideas/an-idea.txt').text, 'An idea\n\nDictated on the train.');
  assert.equal(phone.desk.get('private/a-thought.txt').text, 'A thought');
  assert.deepEqual(phone.desk.getPosts().sort(), ['learns/2026-10-02-y.txt', 'posts/2026-10-01-x.txt']);
});

test('an idea removed by another device leaves this one too, at the next round', async () => {
  const github = createFakeGithub();
  const laptop = device(github);
  const phone = device(github);
  laptop.write('ideas/a.txt', 'Idea');
  await laptop.sync.run();
  await phone.sync.run();
  await laptop.sync.remove('ideas/a.txt');
  await phone.sync.run();
  assert.equal(onRepo(github, 'ideas/a.txt'), null);
  assert.equal(phone.desk.get('ideas/a.txt'), null);
});

test('move to idea: the file goes from drafts/ to ideas/ with "section: idea"', async () => {
  const github = createFakeGithub();
  const laptop = device(github);
  laptop.write(A, 'Draft\n\nTo pick up later.');
  await laptop.sync.run();
  assert.deepEqual(await laptop.sync.move(A, 'idea'), { slug: null, path: 'ideas/a.txt' });
  const idea = onRepo(github, 'ideas/a.txt');
  assert.equal(idea.body, 'To pick up later.');
  assert.equal(idea.meta.section, 'idea');
  assert.ok(idea.meta.started, 'the times travel with the file');
  assert.equal(onRepo(github, A), null);
  assert.equal(laptop.desk.get(A), null);
  assert.ok(laptop.desk.get('ideas/a.txt').sha);
  assert.equal(laptop.desk.get('ideas/a.txt').pending, null);
});

test('move to draft: the section line goes away, the name stays', async () => {
  const github = createFakeGithub();
  const laptop = device(github);
  laptop.write(A, 'Draft');
  await laptop.sync.run();
  await laptop.sync.move(A, 'idea');
  assert.deepEqual(await laptop.sync.move('ideas/a.txt', 'draft'), { slug: null, path: A });
  assert.equal(onRepo(github, A).meta.section, undefined);
  assert.equal(onRepo(github, 'ideas/a.txt'), null);
});

test('in the arrival folder a name already taken becomes -2', async () => {
  const github = createFakeGithub();
  const laptop = device(github);
  laptop.write('ideas/a.txt', 'Another idea');
  laptop.write(A, 'Draft');
  await laptop.sync.run();
  assert.equal((await laptop.sync.move(A, 'idea')).path, 'ideas/a-2.txt');
  assert.equal(onRepo(github, 'ideas/a.txt').title, 'Another idea');
});

test('move to post from an idea works like publish: date and "finished" of today, address from the title', async () => {
  const github = createFakeGithub();
  const laptop = device(github);
  laptop.write('ideas/a-note.txt', 'First post\n\nBody.');
  await laptop.sync.run();
  assert.deepEqual(await laptop.sync.move('ideas/a-note.txt', 'post', NOW), { slug: 'first-post', path: 'posts/2026-10-05-first-post.txt' });
  const post = onRepo(github, 'posts/2026-10-05-first-post.txt');
  assert.match(post.meta.finished, /^2026-10-05T08:02[+-]\d{2}:\d{2}$/);
  assert.equal(post.meta.section, 'post');
  assert.equal(onRepo(github, 'ideas/a-note.txt'), null);
  assert.ok(laptop.desk.getPosts().includes('posts/2026-10-05-first-post.txt'));
});

test('publish as learn: the piece goes to learns/ with "section: learn", the pills stay in the text', async () => {
  const github = createFakeGithub();
  const laptop = device(github);
  laptop.write(A, 'How caching lied to me\n\nThe story.' + PILLS);
  await laptop.sync.run();
  assert.deepEqual(await laptop.sync.publish(A, NOW, 'learn'), { slug: 'how-caching-lied-to-me', path: 'learns/2026-10-05-how-caching-lied-to-me.txt' });
  const learn = onRepo(github, 'learns/2026-10-05-how-caching-lied-to-me.txt');
  assert.equal(learn.meta.section, 'learn');
  assert.ok(learn.body.endsWith('pill: How? | Like this.'));
});

test('a post and a learn published by the editor pass the build: no unknown key in their time block', async () => {
  const github = createFakeGithub();
  const laptop = device(github);
  laptop.write(A, 'First post\n\nBody.');
  laptop.write(B, 'How caching lied to me\n\nThe story.' + PILLS);
  await laptop.sync.run();
  const post = await laptop.sync.publish(A, NOW);
  const learn = await laptop.sync.publish(B, NOW, 'learn');
  const root = await mkdtemp(join(tmpdir(), 'blog-published-'));
  for (const { path } of [post, learn]) {
    const content = github.branches.main.get(path);
    assert.equal(unknownKey(parsePost(content).meta), '', path);
    await mkdir(join(root, path.split('/')[0]), { recursive: true });
    await writeFile(join(root, path), content);
  }
  await writeFile(join(root, 'site.json'), JSON.stringify({ name: 'A test blog', lang: 'en', learns: { title: 'Notes', intro: 'Things I found out.' } }));
  const built = await build({ postsDir: join(root, 'posts'), learnsDir: join(root, 'learns'), outDir: join(root, 'public'), configDir: root, demo: false });
  assert.equal(built, 1);
});

test('a text with fewer than two pills is not published as learn', async () => {
  const github = createFakeGithub();
  const laptop = device(github);
  laptop.write(A, 'A story\n\nThe body.\n\npill: Only one? | Yes.');
  await laptop.sync.run();
  await assert.rejects(laptop.sync.publish(A, NOW, 'learn'), (e) => /at least two/.test(e.error));
  assert.equal(github.branches.main.size, 0);
  assert.ok(laptop.desk.get(A));
});

test('a learn titled "Index" does not take the address index: it becomes index-2', async () => {
  const github = createFakeGithub();
  const laptop = device(github);
  laptop.write(A, 'Index\n\nThe story.' + PILLS);
  await laptop.sync.run();
  assert.deepEqual(await laptop.sync.publish(A, NOW, 'learn'), { slug: 'index-2', path: 'learns/2026-10-05-index-2.txt' });
  assert.equal(onRepo(github, 'learns/2026-10-05-index-2.txt').title, 'Index');
  assert.equal(onRepo(github, 'learns/2026-10-05-index.txt'), null);
});

test('"delete" on a post moves it to private: it leaves the site, and stays in the repo with its times', async () => {
  const github = createFakeGithub();
  const laptop = device(github);
  const phone = device(github);
  laptop.write(A, 'First post\n\nBody.');
  await laptop.sync.run();
  const { path } = await laptop.sync.publish(A, NOW);
  await openOn(laptop, path);
  await openOn(phone, path);
  assert.deepEqual(await laptop.sync.move(path, 'private'), { slug: null, path: 'private/first-post.txt' });
  assert.equal(github.branches.main.has(path), false);
  const kept = onRepo(github, 'private/first-post.txt');
  assert.equal(kept.body, 'Body.');
  assert.equal(kept.meta.section, 'private');
  assert.match(kept.meta.finished, /^2026-10-05T08:02/);
  assert.equal(laptop.desk.get(path), null);
  assert.ok(!laptop.desk.getPosts().includes(path));
  await phone.sync.run();
  assert.equal(phone.desk.get(path), null, 'it also leaves the device that had it open');
  assert.ok(phone.desk.get('private/first-post.txt'));
});

test('a piece put back online after private keeps date and address; if the address was taken, -2', async () => {
  const github = createFakeGithub();
  const laptop = device(github);
  const later = new Date(2026, 9, 20, 9, 0);
  laptop.write(A, 'First post\n\nBody.');
  await laptop.sync.run();
  const first = await laptop.sync.publish(A, NOW);
  await openOn(laptop, first.path);
  await laptop.sync.move(first.path, 'private');
  const back = await laptop.sync.move('private/first-post.txt', 'post', later);
  assert.deepEqual(back, first);
  assert.match(onRepo(github, back.path).meta.finished, /^2026-10-05T08:02/);
  await openOn(laptop, back.path);
  await laptop.sync.move(back.path, 'private');
  laptop.write(B, 'First post\n\nAnother text.');
  await laptop.sync.run();
  await laptop.sync.publish(B, later);
  assert.deepEqual(await laptop.sync.move('private/first-post.txt', 'post', later), { slug: 'first-post-2', path: 'posts/2026-10-05-first-post-2.txt' });
});

test('if deleting the published piece fails, the error says so and trying again makes no duplicates', async () => {
  const github = createFakeGithub();
  const laptop = device(github);
  laptop.write(A, 'First post\n\nBody.');
  await laptop.sync.run();
  const { path } = await laptop.sync.publish(A, NOW);
  await openOn(laptop, path);
  const failing = async (action, params) => {
    if (action === 'delete') throw { status: 0, error: 'offline' };
    return laptop.door(action, params);
  };
  await assert.rejects(createSync({ desk: laptop.desk, door: failing }).move(path, 'private'), (e) => /still online/.test(e.error));
  assert.ok(github.branches.main.has(path));
  assert.ok(laptop.desk.get(path), 'the post stays on the desk: it can be tried again');
  await laptop.sync.move(path, 'private');
  assert.equal(github.branches.main.has(path), false);
  assert.deepEqual([...github.branches.drafts.keys()].filter((p) => p.startsWith('private/')), ['private/first-post.txt']);
});

test('offline a file that never went up changes section on the device; an uploaded one stays where it was', async () => {
  const github = createFakeGithub();
  const phone = device(github);
  phone.write(A, 'Draft already uploaded');
  await phone.sync.run();
  phone.net.offline = true;
  phone.write('drafts/on-the-train.txt', 'An idea on the train');
  const calls = github.state.calls.length;
  assert.deepEqual(await phone.sync.move('drafts/on-the-train.txt', 'idea'), { slug: null, path: 'ideas/on-the-train.txt' });
  assert.equal(github.state.calls.length, calls, 'no network call');
  assert.equal(phone.desk.get('drafts/on-the-train.txt'), null);
  assert.equal(parsePost(phone.desk.get('ideas/on-the-train.txt').pending).meta.section, 'idea');
  await assert.rejects(phone.sync.move(A, 'private'), (e) => e.status === 0);
  assert.ok(phone.desk.get(A));
  phone.net.offline = false;
  await phone.sync.run();
  assert.equal(onRepo(github, 'ideas/on-the-train.txt').meta.section, 'idea');
  assert.equal(onRepo(github, A).title, 'Draft already uploaded');
});

test('a file changed elsewhere, one with work not uploaded, or one during a round is not moved', async () => {
  const github = createFakeGithub();
  const laptop = device(github);
  const phone = device(github);
  laptop.write(A, 'Draft\n\nOld.');
  await laptop.sync.run();
  await phone.sync.run();
  phone.write(A, 'Draft\n\nNew.');
  await phone.sync.run();
  await assert.rejects(laptop.sync.move(A, 'idea'), (e) => e.status === 409 && /changed elsewhere/.test(e.error));
  laptop.desk.type(A, 'Draft\n\nWith a keystroke.', newTimes());
  await assert.rejects(laptop.sync.move(A, 'idea'), (e) => /must be uploaded first/.test(e.error));
  phone.write(B, 'Other');
  const running = phone.sync.run();
  await assert.rejects(phone.sync.move(A, 'idea'), (e) => /sync in progress/.test(e.error));
  await running;
  await assert.rejects(phone.sync.move(A, 'draft'), (e) => /already in this section/.test(e.error));
  assert.ok(onRepo(github, A));
  assert.equal(github.branches.drafts.has('ideas/a.txt'), false);
});

test('a published piece open here and corrected elsewhere is read again at the round: "sync and try again" really works', async () => {
  const github = createFakeGithub();
  const laptop = device(github);
  const phone = device(github);
  laptop.write(A, 'First post\n\nBody.');
  await laptop.sync.run();
  const { path } = await laptop.sync.publish(A, NOW);
  await openOn(laptop, path);
  await openOn(phone, path);
  phone.write(path, 'First post\n\nBody corrected on the phone.');
  await phone.sync.run();
  await assert.rejects(laptop.sync.move(path, 'private'), (e) => e.status === 409 && /sync and try again/.test(e.error));
  await laptop.sync.run();
  assert.deepEqual(await laptop.sync.move(path, 'private'), { slug: null, path: 'private/first-post.txt' });
  assert.equal(onRepo(github, 'private/first-post.txt').body, 'Body corrected on the phone.');
  assert.equal(github.branches.main.has(path), false);
});

test('a learn already online corrected in the editor: with a pill removed it does not go up, with good pills it does', async () => {
  const github = createFakeGithub();
  const laptop = device(github);
  laptop.write(A, 'How caching lied to me\n\nThe story.' + PILLS);
  await laptop.sync.run();
  const { path } = await laptop.sync.publish(A, NOW, 'learn');
  await openOn(laptop, path);
  const online = github.branches.main.get(path);
  const writes = () => github.state.calls.filter((c) => c.startsWith('PUT')).length;
  const before = writes();
  laptop.write(path, 'How caching lied to me\n\nThe story.\n\npill: Why? | Because.');
  const out = await laptop.sync.run();
  assert.equal(out.ok, false);
  assert.equal(out.status, -1);
  assert.match(out.error, /a learn needs at least two "pill: question \| answer" lines at the end of the text \(found 1\)/);
  assert.equal(writes(), before, 'the door does not even get the request');
  assert.equal(github.branches.main.get(path), online);
  assert.notEqual(laptop.desk.get(path).pending, null, 'the save stays to upload: fix it and save again');
  laptop.write(path, 'How caching lied to me\n\nThe story, corrected.' + PILLS);
  assert.deepEqual(await laptop.sync.run(), { ok: true });
  assert.equal(onRepo(github, path).body, 'The story, corrected.' + PILLS);
  assert.equal(laptop.desk.get(path).pending, null);
});

test('"keep mine" on a learn in conflict: with a single pill it does not go up, with two it does', async () => {
  const github = createFakeGithub();
  const laptop = device(github);
  const phone = device(github);
  laptop.write(A, 'How caching lied to me\n\nThe story.' + PILLS);
  await laptop.sync.run();
  const { path } = await laptop.sync.publish(A, NOW, 'learn');
  await openOn(laptop, path);
  await openOn(phone, path);
  phone.write(path, 'How caching lied to me\n\nThe story, from the phone.' + PILLS);
  await phone.sync.run();
  laptop.write(path, 'How caching lied to me\n\nThe story, from the laptop.\n\npill: Why? | Because.');
  await laptop.sync.run();
  assert.equal(laptop.desk.get(path).conflict, 'changed');
  const online = github.branches.main.get(path);
  const calls = github.state.calls.length;
  await assert.rejects(laptop.sync.resolve(path, 'mine'), (e) => e.status === -1 && /\(found 1\)/.test(e.error));
  assert.equal(github.state.calls.length, calls, 'no call to the door');
  assert.equal(github.branches.main.get(path), online);
  assert.equal(laptop.desk.get(path).conflict, 'changed', 'the conflict stays: fix it and choose again');
  laptop.write(path, 'How caching lied to me\n\nThe story, from the laptop.' + PILLS);
  await laptop.sync.resolve(path, 'mine');
  assert.equal(onRepo(github, path).body, 'The story, from the laptop.' + PILLS);
  assert.equal(laptop.desk.get(path).conflict, null);
  assert.equal(laptop.desk.get(path).pending, null);
});

for (const [section, text] of [['post', 'First post\n\nBody.'], ['learn', 'How caching lied to me\n\nThe story.' + PILLS]]) {
  test(`a ${section} taken off the site elsewhere and saved here during the round: it does not go back online by itself, it becomes the "gone" question`, async () => {
    const github = createFakeGithub();
    const laptop = device(github);
    const phone = device(github);
    laptop.write(A, text);
    await laptop.sync.run();
    const { path, slug } = await laptop.sync.publish(A, NOW, section);
    await openOn(laptop, path);
    await openOn(phone, path);
    await phone.sync.move(path, 'private');
    laptop.write(B, 'Other\n\nWaiting.');
    const corrected = text.replace('\n\n', '\n\nA correction. ');
    const sync = during(laptop, 'write', () => laptop.write(path, corrected));
    assert.deepEqual(await sync.run(), { ok: true });
    assert.equal(laptop.desk.get(path).sha, null, 'the copy born again has no sha');
    assert.notEqual(laptop.desk.get(path).pending, null);
    await laptop.sync.run();
    assert.equal(github.branches.main.has(path), false, 'it does not go back online without a question');
    assert.equal(laptop.desk.get(path).conflict, 'gone');
    assert.equal(laptop.desk.get(path).text, corrected, 'the correction stays on the desk');
    assert.ok(onRepo(github, `private/${slug}.txt`), 'the copy in private stays');
    await laptop.sync.resolve(path, 'reupload');
    assert.ok(onRepo(github, path).body.startsWith('A correction.'));
    assert.equal(laptop.desk.get(path).conflict, null);
  });
}

test('a learn moved to post with pill: lines at the end is refused before the network; going through draft it works', async () => {
  const github = createFakeGithub();
  const laptop = device(github);
  laptop.write(A, 'How caching lied to me\n\nThe story.' + PILLS);
  await laptop.sync.run();
  const { path } = await laptop.sync.publish(A, NOW, 'learn');
  await openOn(laptop, path);
  const calls = github.state.calls.length;
  await assert.rejects(laptop.sync.move(path, 'post', NOW),
    (e) => e.status === -1 && /remove the pill: lines at the end before moving it to post/.test(e.error));
  assert.equal(github.state.calls.length, calls, 'no call to the door');
  assert.ok(github.branches.main.has(path), 'the learn stays online');
  assert.ok(laptop.desk.get(path));
  const { path: draft } = await laptop.sync.move(path, 'draft');
  laptop.write(draft, 'How caching lied to me\n\nThe story.');
  await laptop.sync.run();
  const out = await laptop.sync.publish(draft, NOW, 'post');
  assert.equal(onRepo(github, out.path).body, 'The story.');
  assert.equal(github.branches.main.has(path), false);
});

test('the draft of a learn with pill: lines at the end is not published as post (Enter picks post): refused before the network; as learn it is', async () => {
  const github = createFakeGithub();
  const laptop = device(github);
  laptop.write(A, 'How caching lied to me\n\nThe story.' + PILLS);
  laptop.write('ideas/a-note.txt', 'An idea\n\nThe note.' + PILLS);
  await laptop.sync.run();
  const calls = github.state.calls.length;
  const refused = (e) => e.status === -1 && /remove the pill: lines at the end before moving it to post/.test(e.error);
  await assert.rejects(laptop.sync.publish(A, NOW), refused);
  await assert.rejects(laptop.sync.move('ideas/a-note.txt', 'post', NOW), refused, 'it holds from every section, not only from drafts');
  assert.equal(github.state.calls.length, calls, 'no call to the door');
  assert.equal(github.branches.main.size, 0);
  assert.ok(laptop.desk.get(A));
  assert.deepEqual(await laptop.sync.publish(A, NOW, 'learn'), { slug: 'how-caching-lied-to-me', path: 'learns/2026-10-05-how-caching-lied-to-me.txt' });
});
