import { createHash, timingSafeEqual } from 'node:crypto';

const PATH_RE = /^(posts|learns|drafts|ideas|private)\/[a-z0-9-]+\.txt$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;
const BRANCH = { posts: 'main', learns: 'main', drafts: 'drafts', ideas: 'drafts', private: 'drafts' };
const LIST_ORDER = ['drafts', 'posts', 'learns', 'ideas', 'private'];
const MAX_BYTES = 500 * 1024;
const GITHUB = 'https://api.github.com';

function reply(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function samePassword(given, expected) {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function refused(res) {
  if (res.status === 404) return reply(404, { error: 'not found' });
  if (res.status === 409 || res.status === 422) return reply(409, { error: 'the file changed elsewhere' });
  if (res.status === 401 || res.status === 403) return reply(502, { error: 'GitHub token refused or expired' });
  return reply(502, { error: 'GitHub answered ' + res.status });
}

export async function handle(request, { env, fetch, failDelayMs = 500, minPasswordLength = 32 }) {
  if (env.BLOG_DEMO === '1') return reply(403, { error: 'demo: saving is off' });
  if (!env.BLOG_PASSWORD || !env.GITHUB_TOKEN || !env.GITHUB_REPO) return reply(500, { error: 'missing secrets' });
  if (env.BLOG_PASSWORD.length < minPasswordLength) return reply(500, { error: 'password too short: it needs at least 32 characters' });

  let input;
  try { input = await request.json(); } catch { return reply(400, { error: 'invalid request' }); }
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return reply(400, { error: 'invalid request' });

  const header = request.headers.get('authorization') || '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!samePassword(given, env.BLOG_PASSWORD)) {
    await pause(failDelayMs);
    return reply(401, { error: 'wrong password' });
  }

  const github = (path, init = {}) => fetch(`${GITHUB}/repos/${env.GITHUB_REPO}${path}`, {
    ...init,
    headers: {
      authorization: 'Bearer ' + env.GITHUB_TOKEN,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'a-proper-underground-blog',
    },
  });
  const send = (method, path, body) => github(path, { method, body: JSON.stringify(body) });

  const { action, path, content, sha, ref } = input;

  try {
    if (action === 'list') {
      const out = {};
      const checked = new Set();
      for (const dir of LIST_ORDER) {
        const res = await github(`/contents/${dir}?ref=${BRANCH[dir]}`);
        if (res.status === 404) {
          if (!checked.has(BRANCH[dir])) {
            const found = await github(`/branches/${BRANCH[dir]}`);
            if (!found.ok) return reply(502, { error: `branch "${BRANCH[dir]}" not reachable: check GITHUB_REPO, the token and the branches` });
            checked.add(BRANCH[dir]);
          }
          out[dir] = [];
          continue;
        }
        if (!res.ok) return refused(res);
        const entries = await res.json();
        out[dir] = entries
          .filter((e) => e.type === 'file' && PATH_RE.test(e.path))
          .map((e) => ({ path: e.path, sha: e.sha }));
      }
      return reply(200, out);
    }

    if (typeof path !== 'string' || !PATH_RE.test(path)) return reply(400, { error: 'invalid path' });
    const branch = BRANCH[path.split('/')[0]];
    const message = typeof input.message === 'string' && input.message
      ? input.message.slice(0, 100)
      : `${action} ${path}`;

    if (action === 'read') {
      if (ref !== undefined && (typeof ref !== 'string' || !COMMIT_RE.test(ref))) return reply(400, { error: 'invalid version' });
      const res = await github(`/contents/${path}?ref=${ref || branch}`);
      if (!res.ok) return refused(res);
      const found = await res.json();
      return reply(200, { path, sha: found.sha, content: Buffer.from(found.content, 'base64').toString('utf8') });
    }

    if (action === 'write') {
      if (typeof content !== 'string' || content.trim() === '' || Buffer.byteLength(content, 'utf8') > MAX_BYTES) {
        return reply(400, { error: 'text missing, empty or too long' });
      }
      const body = { message, branch, content: Buffer.from(content, 'utf8').toString('base64') };
      if (typeof sha === 'string' && sha) body.sha = sha;
      const res = await send('PUT', `/contents/${path}`, body);
      if (!res.ok) return refused(res);
      return reply(200, { path, sha: (await res.json()).content.sha });
    }

    if (action === 'delete') {
      if (typeof sha !== 'string' || !sha) return reply(400, { error: 'missing sha' });
      const res = await send('DELETE', `/contents/${path}`, { message, branch, sha });
      if (!res.ok) return refused(res);
      return reply(200, { path });
    }

    if (action === 'history') {
      const res = await github(`/commits?sha=${branch}&path=${encodeURIComponent(path)}&per_page=50`);
      if (!res.ok) return refused(res);
      const commits = await res.json();
      return reply(200, {
        path,
        versions: commits.map((c) => ({ ref: c.sha, date: c.commit.committer.date, message: c.commit.message })),
      });
    }

    return reply(400, { error: 'unknown action' });
  } catch {
    return reply(502, { error: 'GitHub not reachable' });
  }
}
