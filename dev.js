import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { handle } from './server/door.js';
import { build } from './build.js';
import { createFakeGithub } from './fakes/github.js';

const ENV = { BLOG_PASSWORD: 'test', GITHUB_TOKEN: 'fake', GITHUB_REPO: 'someone/blog', BLOG_DEMO: process.env.BLOG_DEMO };
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};
const DEV = '.dev';
const CONFIG_DIR = '.';
const github = createFakeGithub();

if (process.argv.includes('--demo')) {
  github.branches.main.set('posts/2026-10-01-a-test-post.txt',
    'A test post\n\nThis is not a real post: it shows the page.\nLetters beyond ASCII: café, naïve — a dash. An address: https://example.com/a-page.\n\n    function greet(name) {\n      return "hello, " + name;\n    }\n\nA long paragraph shows how the text wraps and how dense the grey of the page looks, on a wide screen and on a phone.\n\n--\nstarted: 2026-10-01T21:14+00:00\nfinished: 2026-10-01T22:40+00:00\nwritten: 61 min\nsessions: 2\n');
  github.branches.main.set('posts/2026-09-28-a-second-title.txt', 'A second title, longer than the others\n\nSecond test text.\n');
  github.branches.drafts.set('drafts/a-draft.txt', 'A draft\n\nText not published yet.\n');
  github.branches.main.set('learns/2026-10-19-why-my-phone-showed-the-old-page.txt',
    'Why my phone showed the old page\n\nI changed one line and nothing moved.\n\nThe copy was old.\n\npill: Why did the phone show the old page? | Its saved copy answered first.\npill: What makes the copy change? | A new <sw.js> & a reload.\n\n--\nstarted: 2026-10-18T21:14+00:00\nfinished: 2026-10-19T08:02+00:00\nwritten: 20 min\nsessions: 1\nsection: learn\n');
  github.branches.main.set('learns/2026-10-12-a-test-that-lied.txt',
    'A test that lied\n\nIt was green.\n\npill: When is a green test a lie? | When it checks the wrong thing.\npill: How do you catch it? | Make it fail first.\n');
  github.branches.drafts.set('ideas/a-dictated-idea.txt', 'A dictated idea\n\nTo pick up again later.\n\n--\nsection: idea\n');
  github.branches.drafts.set('private/a-thought.txt', 'A thought\n\nJust for me.\n\n--\nsection: private\n');
}

async function rebuild() {
  for (const dir of ['posts', 'learns']) {
    await rm(join(DEV, dir), { recursive: true, force: true });
    await mkdir(join(DEV, dir), { recursive: true });
  }
  for (const [path, text] of github.branches.main) {
    await mkdir(dirname(join(DEV, path)), { recursive: true });
    await writeFile(join(DEV, path), text);
  }
  await build({ postsDir: join(DEV, 'posts'), learnsDir: join(DEV, 'learns'), configDir: CONFIG_DIR });
}

await rebuild();

createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');

    if (pathname === '/api/repo' && req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString('utf8');
      const request = new Request('http://localhost/api/repo', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: req.headers.authorization || '' },
        body,
      });
      const out = await handle(request, { env: ENV, fetch: github.fetch, failDelayMs: 0, minPasswordLength: 1 });
      let input = null;
      try { input = JSON.parse(body); } catch {}
      const onMain = typeof input?.path === 'string' && /^(posts|learns)[/]/.test(input.path);
      if (out.ok && onMain && (input.action === 'write' || input.action === 'delete')) {
        await rebuild().catch((e) => console.error('build stopped:', e.message));
      }
      res.writeHead(out.status, Object.fromEntries(out.headers));
      return res.end(await out.text());
    }

    if (pathname.includes('..')) throw new Error('path not allowed');
    let file = pathname === '/' ? '/index.html' : pathname;
    if (!extname(file)) file += '.html';
    const data = await readFile(join('public', file));
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] || 'application/octet-stream',
      'content-security-policy': "default-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      'cache-control': 'no-store',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(await readFile(join('public', '404.html')).catch(() => '404'));
  }
}).listen(3000, () => console.log('open on http://localhost:3000  (editor: /write, password: test)'));
