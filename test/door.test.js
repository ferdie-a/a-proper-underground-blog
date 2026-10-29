import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../server/door.js';
import { createFakeGithub } from '../fakes/github.js';

const ENV = { BLOG_PASSWORD: 'a-test-password-that-is-long-enough', GITHUB_TOKEN: 'fake-token', GITHUB_REPO: 'someone/blog' };

async function call(github, body, { password = ENV.BLOG_PASSWORD, env = ENV, raw } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (password !== null) headers.authorization = 'Bearer ' + password;
  const request = new Request('http://localhost/api/repo', { method: 'POST', headers, body: raw ?? JSON.stringify(body) });
  const res = await handle(request, { env, fetch: github.fetch, failDelayMs: 0 });
  return { status: res.status, data: await res.json(), headers: res.headers };
}

test('without secrets it answers 500 and does not call GitHub', async () => {
  const github = createFakeGithub();
  const out = await call(github, { action: 'list' }, { env: {} });
  assert.equal(out.status, 500);
  assert.equal(github.state.calls.length, 0);
});

test('with BLOG_DEMO=1 every request gets 403 "demo: saving is off" and GitHub is never called', async () => {
  const github = createFakeGithub();
  const demo = { ...ENV, BLOG_DEMO: '1' };
  const requests = [
    [{ action: 'list' }, {}],
    [{ action: 'write', path: 'drafts/a.txt', content: 'A\n' }, {}],
    [{ action: 'read', path: 'posts/2026-10-05-a.txt' }, {}],
    [{ action: 'list' }, { password: 'wrong' }],
    [{ action: 'list' }, { password: null }],
    [null, { raw: 'not json' }],
    [{ action: 'list' }, { env: { BLOG_DEMO: '1' }, password: 'anything' }],
  ];
  for (const [body, options] of requests) {
    const out = await call(github, body, { env: demo, ...options });
    assert.equal(out.status, 403, JSON.stringify(body));
    assert.deepEqual(out.data, { error: 'demo: saving is off' });
  }
  assert.equal(github.state.calls.length, 0);
});

test('the demo answer comes before the wrong-password pause', async () => {
  const github = createFakeGithub();
  const request = new Request('http://localhost/api/repo', { method: 'POST', headers: { authorization: 'Bearer wrong' }, body: '{"action":"list"}' });
  const started = Date.now();
  const res = await handle(request, { env: { ...ENV, BLOG_DEMO: '1' }, fetch: github.fetch, failDelayMs: 5000 });
  assert.equal(res.status, 403);
  assert.ok(Date.now() - started < 1000);
});

test('BLOG_DEMO with any value other than 1 leaves the door as it is', async () => {
  const github = createFakeGithub();
  for (const BLOG_DEMO of ['', '0', 'true']) {
    const out = await call(github, { action: 'list' }, { env: { ...ENV, BLOG_DEMO } });
    assert.equal(out.status, 200, BLOG_DEMO);
  }
});

test('with a short password the door does not work', async () => {
  const github = createFakeGithub();
  const env = { ...ENV, BLOG_PASSWORD: 'short' };
  const out = await call(github, { action: 'list' }, { env, password: 'short' });
  assert.equal(out.status, 500);
  assert.match(out.data.error, /too short/);
  assert.equal(github.state.calls.length, 0);
});

test('wrong or missing password: 401, and GitHub is not called', async () => {
  const github = createFakeGithub();
  for (const password of ['wrong', '', null, ENV.BLOG_PASSWORD + 'x']) {
    assert.equal((await call(github, { action: 'list' }, { password })).status, 401);
  }
  assert.equal(github.state.calls.length, 0);
});

test('a request that is not a JSON object: 400', async () => {
  const github = createFakeGithub();
  for (const raw of ['hello', 'null', '"text"', '[]']) {
    assert.equal((await call(github, null, { raw })).status, 400, raw);
  }
});

test('invalid paths: 400, and GitHub is not called', async () => {
  const github = createFakeGithub();
  const bad = ['../secret.txt', 'posts/../x.txt', 'posts/A.txt', 'posts/a.md', 'drafts/a/b.txt', 'api/x.txt', 'posts/.txt', 'drafts/a.txt\n', '', 123, undefined,
    'learn/a.txt', 'idea/a.txt', 'privates/a.txt', 'private/../a.txt', 'ideas/A.txt', 'learns/a/b.txt'];
  for (const path of bad) {
    for (const action of ['read', 'write', 'delete', 'history']) {
      assert.equal((await call(github, { action, path, content: 'x', sha: 'y' })).status, 400, `${action} ${path}`);
    }
  }
  assert.equal(github.state.calls.length, 0);
});

test('unknown action: 400', async () => {
  const github = createFakeGithub();
  assert.equal((await call(github, { action: 'format', path: 'drafts/a.txt' })).status, 400);
});

test('every folder goes to its branch: posts and learns on main, drafts, ideas and private on drafts', async () => {
  const github = createFakeGithub();
  const where = { 'posts/2026-10-03-a.txt': 'main', 'learns/2026-10-19-a.txt': 'main', 'drafts/a.txt': 'drafts', 'ideas/a.txt': 'drafts', 'private/a.txt': 'drafts' };
  for (const path of Object.keys(where)) assert.equal((await call(github, { action: 'write', path, content: path })).status, 200, path);
  for (const [path, branch] of Object.entries(where)) {
    assert.equal(github.branches[branch].get(path), path, path);
    assert.equal(github.branches[branch === 'main' ? 'drafts' : 'main'].has(path), false, path);
  }
});

test('reads back what it wrote, accents included', async () => {
  const github = createFakeGithub();
  const content = 'Café\n\nnaïve «déjà vu» über\n';
  const written = await call(github, { action: 'write', path: 'drafts/a.txt', content });
  const read = await call(github, { action: 'read', path: 'drafts/a.txt' });
  assert.equal(read.status, 200);
  assert.equal(read.data.content, content);
  assert.equal(read.data.sha, written.data.sha);
});

test('reading a file that does not exist: 404', async () => {
  const github = createFakeGithub();
  assert.equal((await call(github, { action: 'read', path: 'drafts/a.txt' })).status, 404);
});

test('updating needs the right sha', async () => {
  const github = createFakeGithub();
  const v1 = await call(github, { action: 'write', path: 'drafts/a.txt', content: 'one' });
  const v2 = await call(github, { action: 'write', path: 'drafts/a.txt', content: 'two', sha: v1.data.sha });
  assert.equal(v2.status, 200);
  assert.notEqual(v2.data.sha, v1.data.sha);
  assert.equal((await call(github, { action: 'write', path: 'drafts/a.txt', content: 'three', sha: v1.data.sha })).status, 409);
  assert.equal((await call(github, { action: 'write', path: 'drafts/a.txt', content: 'three' })).status, 409);
  assert.equal(github.branches.drafts.get('drafts/a.txt'), 'two');
});

test('it deletes in every folder, always with the right sha', async () => {
  const github = createFakeGithub();
  for (const path of ['posts/2026-10-03-a.txt', 'learns/2026-10-19-a.txt', 'drafts/a.txt', 'ideas/a.txt', 'private/a.txt']) {
    const written = await call(github, { action: 'write', path, content: 'x' });
    assert.equal((await call(github, { action: 'delete', path })).status, 400, path);
    assert.equal((await call(github, { action: 'delete', path, sha: 'wrong' })).status, 409, path);
    assert.equal((await call(github, { action: 'delete', path, sha: written.data.sha })).status, 200, path);
    assert.equal((await call(github, { action: 'delete', path, sha: written.data.sha })).status, 404, path);
  }
  assert.equal(github.branches.main.size + github.branches.drafts.size, 0);
});

test('lists the five folders with their shas; empty repo, empty lists', async () => {
  const github = createFakeGithub();
  assert.deepEqual((await call(github, { action: 'list' })).data, { drafts: [], posts: [], learns: [], ideas: [], private: [] });
  const paths = ['drafts/a.txt', 'posts/2026-10-03-a.txt', 'learns/2026-10-19-a.txt', 'ideas/a.txt', 'private/a.txt'];
  const sha = {};
  for (const path of paths) sha[path] = (await call(github, { action: 'write', path, content: path })).data.sha;
  assert.deepEqual((await call(github, { action: 'list' })).data, {
    drafts: [{ path: 'drafts/a.txt', sha: sha['drafts/a.txt'] }],
    posts: [{ path: 'posts/2026-10-03-a.txt', sha: sha['posts/2026-10-03-a.txt'] }],
    learns: [{ path: 'learns/2026-10-19-a.txt', sha: sha['learns/2026-10-19-a.txt'] }],
    ideas: [{ path: 'ideas/a.txt', sha: sha['ideas/a.txt'] }],
    private: [{ path: 'private/a.txt', sha: sha['private/a.txt'] }],
  });
});

test('folders that do not exist yet: each branch is checked only once', async () => {
  const github = createFakeGithub();
  await call(github, { action: 'list' });
  assert.equal(github.state.calls.filter((c) => c.includes('/branches/')).length, 2);
});

test('repo not reachable or branch missing: the list answers 502, not "no files"', async () => {
  const hidden = createFakeGithub();
  hidden.state.missing = true;
  const out = await call(hidden, { action: 'list' });
  assert.equal(out.status, 502);
  assert.match(out.data.error, /not reachable/);
  const noBranch = createFakeGithub();
  delete noBranch.branches.drafts;
  assert.equal((await call(noBranch, { action: 'list' })).status, 502);
});

test('history goes from the most recent and a past version can be read again', async () => {
  const github = createFakeGithub();
  const v1 = await call(github, { action: 'write', path: 'drafts/a.txt', content: 'one', message: 'first' });
  await call(github, { action: 'write', path: 'drafts/a.txt', content: 'two', sha: v1.data.sha, message: 'second' });
  const history = await call(github, { action: 'history', path: 'drafts/a.txt' });
  assert.equal(history.status, 200);
  assert.deepEqual(history.data.versions.map((v) => v.message), ['second', 'first']);
  assert.match(history.data.versions[0].ref, /^[0-9a-f]{40}$/);
  const old = await call(github, { action: 'read', path: 'drafts/a.txt', ref: history.data.versions[1].ref });
  assert.equal(old.data.content, 'one');
});

test('a version that is not a commit sha: 400', async () => {
  const github = createFakeGithub();
  for (const ref of ['main', '../x', 'abc', 42]) {
    assert.equal((await call(github, { action: 'read', path: 'drafts/a.txt', ref })).status, 400);
  }
});

test('missing or too long text: 400', async () => {
  const github = createFakeGithub();
  assert.equal((await call(github, { action: 'write', path: 'drafts/a.txt' })).status, 400);
  assert.equal((await call(github, { action: 'write', path: 'drafts/a.txt', content: 42 })).status, 400);
  assert.equal((await call(github, { action: 'write', path: 'drafts/a.txt', content: 'a'.repeat(500 * 1024 + 1) })).status, 400);
  assert.equal((await call(github, { action: 'write', path: 'drafts/a.txt', content: '' })).status, 400);
  assert.equal((await call(github, { action: 'write', path: 'drafts/a.txt', content: '  \n ' })).status, 400);
  assert.equal(github.state.calls.length, 0);
});

test('the commit message: the one asked for, cut to 100 characters, or a default one', async () => {
  const github = createFakeGithub();
  await call(github, { action: 'write', path: 'drafts/a.txt', content: 'x', message: 'm'.repeat(300) });
  assert.equal(github.commits[0].message.length, 100);
  await call(github, { action: 'write', path: 'drafts/b.txt', content: 'x' });
  assert.equal(github.commits[0].message, 'write drafts/b.txt');
});

test('GitHub not answering: 502', async () => {
  const github = createFakeGithub();
  github.state.down = true;
  assert.equal((await call(github, { action: 'list' })).status, 502);
});

test('token refused: 502 with a message that says so', async () => {
  const github = createFakeGithub();
  github.state.status = 401;
  const out = await call(github, { action: 'read', path: 'drafts/a.txt' });
  assert.equal(out.status, 502);
  assert.match(out.data.error, /token/);
});

test('GitHub gets the token, never the password; answers are not cached', async () => {
  const github = createFakeGithub();
  const out = await call(github, { action: 'list' });
  assert.equal(github.state.auth, 'Bearer fake-token');
  assert.equal(out.headers.get('cache-control'), 'no-store');
  assert.ok(!JSON.stringify(out.data).includes(ENV.BLOG_PASSWORD));
});

test('the server entry passes the request to the door', async () => {
  const { POST } = await import('../api/repo.js');
  const saved = process.env.BLOG_DEMO;
  delete process.env.BLOG_DEMO;
  try {
    const res = await POST(new Request('http://localhost/api/repo', { method: 'POST', body: '{}' }));
    assert.equal(res.status, 500);
  } finally {
    if (saved !== undefined) process.env.BLOG_DEMO = saved;
  }
});
