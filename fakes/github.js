import { createHash } from 'node:crypto';

const sha1 = (text) => createHash('sha1').update(text).digest('hex');
const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const file = (path, text) => ({ type: 'file', path, sha: sha1(text), encoding: 'base64', content: Buffer.from(text, 'utf8').toString('base64') });

export function createFakeGithub() {
  const branches = { main: new Map(), drafts: new Map() };
  const commits = [];
  const state = { down: false, status: null, missing: false, calls: [], auth: null };

  function commit(branch, path, message) {
    commits.unshift({
      sha: sha1('commit ' + commits.length),
      branch, path, message,
      date: new Date(Date.UTC(2026, 9, 3, 12, 0, commits.length)).toISOString(),
      text: branches[branch].get(path) ?? null,
    });
  }

  async function fetchFake(url, init = {}) {
    const method = init.method || 'GET';
    const u = new URL(url);
    state.calls.push(`${method} ${u.pathname}${u.search}`);
    state.auth = init.headers?.authorization ?? null;
    if (state.down) throw new TypeError('fetch failed');
    if (state.status) return json(state.status, { message: 'forced answer' });
    if (state.missing) return json(404, { message: 'Not Found' });

    if (/^\/repos\/[^/]+\/[^/]+\/commits$/.test(u.pathname)) {
      const branch = u.searchParams.get('sha');
      const path = u.searchParams.get('path');
      const list = commits.filter((c) => c.branch === branch && c.path === path);
      return json(200, list.map((c) => ({ sha: c.sha, commit: { message: c.message, committer: { date: c.date } } })));
    }

    const branch = u.pathname.match(/^\/repos\/[^/]+\/[^/]+\/branches\/([^/]+)$/);
    if (branch) return branches[branch[1]] ? json(200, { name: branch[1] }) : json(404, {});

    const m = u.pathname.match(/^\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/);
    if (!m) return json(404, {});
    const path = decodeURIComponent(m[1]);

    if (method === 'GET') {
      const ref = u.searchParams.get('ref');
      const old = commits.find((c) => c.sha === ref);
      if (old) return old.path === path && old.text !== null ? json(200, file(path, old.text)) : json(404, {});
      const files = branches[ref];
      if (!files) return json(404, {});
      if (files.has(path)) return json(200, file(path, files.get(path)));
      const inside = [...files.keys()].filter((p) => p.startsWith(path + '/'));
      if (inside.length === 0) return json(404, {});
      return json(200, inside.map((p) => ({ type: 'file', name: p.split('/').pop(), path: p, sha: sha1(files.get(p)) })));
    }

    const body = JSON.parse(init.body);
    const files = branches[body.branch];
    if (!files) return json(404, {});
    const current = files.has(path) ? sha1(files.get(path)) : null;

    if (method === 'PUT') {
      if (current && !body.sha) return json(422, { message: '"sha" wasn\'t supplied.' });
      if (current !== (body.sha || null)) return json(409, { message: 'sha does not match' });
      files.set(path, Buffer.from(body.content, 'base64').toString('utf8'));
      commit(body.branch, path, body.message);
      return json(current ? 200 : 201, { content: { path, sha: sha1(files.get(path)) } });
    }

    if (method === 'DELETE') {
      if (!current) return json(404, {});
      if (current !== body.sha) return json(409, {});
      files.delete(path);
      commit(body.branch, path, body.message);
      return json(200, { content: null });
    }

    return json(405, {});
  }

  return { fetch: fetchFake, branches, commits, state };
}
