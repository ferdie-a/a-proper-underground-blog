import {
  RESERVED_SLUGS, slugify, uniqueSlug, splitTitleBody, fileFromRecord, recordFromFile, localStamp, hasBrokenBlock, splitPills, pillProblem, parsePost,
  SECTIONS, FOLDER, SECTION_LABEL, isPublic, sectionOf, nameOf, plainPath, publishedPath, parsePublishedPath, withSection,
} from './lib/post.js';

const RESERVED_LEARN_SLUGS = ['index'];

function learnProblem(path, content) {
  return sectionOf(path) === 'learn' ? pillProblem(parsePost(content).body) : '';
}

export function doorClient(getPassword, fetchImpl = (...args) => fetch(...args)) {
  return async function door(action, params = {}) {
    const password = getPassword();
    if (/[^\x20-\x7e]/.test(password)) throw { status: 401, error: 'wrong password' };
    let res;
    try {
      res = await fetchImpl('/api/repo', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + password },
        body: JSON.stringify({ action, ...params }),
      });
    } catch {
      throw { status: 0, error: 'offline' };
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw { status: res.status, error: data.error || 'error ' + res.status };
    return data;
  };
}

export function demoDoor(desk, password) {
  let count = 0;
  return async function door(action, params = {}) {
    if (desk.getPassword() !== password) throw { status: 401, error: 'wrong password' };
    if (action === 'history') throw { status: -1, error: 'demo: no history' };
    if (action === 'list') {
      const listing = Object.fromEntries(SECTIONS.map((section) => [FOLDER[section], []]));
      for (const r of desk.list()) {
        const section = sectionOf(r.path);
        if (section !== null && r.sha !== null) listing[FOLDER[section]].push({ path: r.path, sha: r.sha });
      }
      return listing;
    }
    const local = desk.get(params.path);
    if (action === 'read') {
      if (!local || local.sha === null) throw { status: 404, error: 'not found' };
      return { content: local.stored ?? fileFromRecord(local), sha: local.sha };
    }
    if (action === 'write') {
      count += 1;
      const sha = 'demo-' + Date.now().toString(36) + '-' + count;
      const stored = params.content;
      desk.put(params.path, local ? { ...local, sha, stored } : { ...recordFromFile(stored, sha), stored });
      return { sha };
    }
    if (action === 'delete') {
      if (local && (local.dirty || local.pending !== null)) desk.put(params.path, { ...local, sha: null });
      else if (local) desk.remove(params.path);
      return {};
    }
    throw { status: 400, error: 'invalid request' };
  };
}

export function createSync({ desk, door }) {
  let running = false;

  async function download() {
    const listing = await door('list');
    const published = [...listing.posts, ...listing.learns];
    desk.setPosts(published.map((p) => p.path));
    const opened = published.filter((p) => desk.get(p.path) !== null);
    const remote = new Map([...listing.drafts, ...listing.ideas, ...listing.private, ...opened].map((d) => [d.path, d.sha]));
    const everywhere = new Set(SECTIONS.flatMap((section) => listing[FOLDER[section]]).map((p) => p.path));

    for (const [path, sha] of remote) {
      const local = desk.get(path);
      if (local && local.sha === sha) continue;
      if (local && local.pending !== null) { desk.setConflict(path, 'changed'); continue; }
      if (local && local.dirty) continue;
      const found = await door('read', { path });
      desk.fromRepo(path, found.content, found.sha);
    }

    for (const local of desk.list()) {
      if (sectionOf(local.path) === null || everywhere.has(local.path) || local.sha === null) continue;
      if (local.pending !== null) desk.setConflict(local.path, 'gone');
      else if (!local.dirty) desk.remove(local.path);
    }
  }

  async function upload() {
    let rejected = null;
    for (const local of desk.list()) {
      if (local.pending === null || local.conflict) continue;
      const content = local.pending;
      const note = local.message ?? null;
      if (isPublic(sectionOf(local.path)) && local.sha === null) { desk.setConflict(local.path, 'gone'); continue; }
      const pills = learnProblem(local.path, content);
      if (pills) { rejected = rejected || { status: -1, error: pills }; continue; }
      try {
        const res = await door('write', {
          path: local.path, content, message: note || 'save ' + local.path,
          ...(local.sha ? { sha: local.sha } : {}),
        });
        desk.uploaded(local.path, res.sha, content, note);
      } catch (e) {
        if (e.status === 409) desk.setConflict(local.path, 'changed');
        else if (e.status === 400) rejected = rejected || e;
        else throw e;
      }
    }
    if (rejected) throw rejected;
  }

  async function run() {
    if (running) return { ok: true };
    running = true;
    try {
      await download();
      await upload();
      return { ok: true };
    } catch (e) {
      return { ok: false, status: e.status ?? -1, error: e.error || String(e.message || e) };
    } finally {
      running = false;
    }
  }

  async function resolve(path, choice, forkPath) {
    const local = desk.get(path);
    if (!local) throw { status: -1, error: 'the file is no longer on this device' };
    if (choice === 'fork' && desk.get(forkPath)) throw { status: -1, error: 'name already used' };
    const content = local.pending;
    const note = local.message ?? null;
    const untouched = () => {
      const now = desk.get(path);
      return now !== null && now.pending === content && now.text === local.text;
    };
    const settle = (sha) => {
      desk.uploaded(path, sha, content, note);
      desk.setConflict(path, null);
    };

    if (choice === 'discard') return desk.remove(path);

    if (choice === 'mine' || choice === 'reupload') {
      const pills = learnProblem(path, content);
      if (pills) throw { status: -1, error: pills };
    }

    if (choice === 'reupload') {
      const res = await door('write', { path, content, message: note || 'save ' + path });
      return settle(res.sha);
    }

    if (choice === 'fork') {
      const res = await door('write', { path: forkPath, content, message: note || 'variant of ' + path });
      desk.put(forkPath, { ...local, sha: res.sha, pending: null, conflict: null, message: null });
      const now = desk.get(path);
      if (note && now && now.message === note) desk.put(path, { ...now, message: null });
    }

    const remote = await door('read', { path });
    if (choice === 'mine') {
      const res = await door('write', { path, content, sha: remote.sha, message: note || 'save ' + path });
      settle(res.sha);
    } else if (untouched()) {
      desk.fromRepo(path, remote.content, remote.sha, { force: true });
    }
  }

  async function remove(path) {
    const section = sectionOf(path);
    if (section === null || isPublic(section)) throw { status: -1, error: 'only drafts, ideas and private files can be deleted' };
    if (running) throw { status: -1, error: 'sync in progress: try again in a moment' };
    const local = desk.get(path);
    if (!local) return;
    running = true;
    try {
      if (local.sha !== null) {
        try { await door('delete', { path, sha: local.sha, message: 'delete ' + path }); }
        catch (e) { if (e.status !== 404) throw e; }
      }
      desk.remove(path);
    } finally {
      running = false;
    }
  }

  const namesOnDesk = (section) => desk.list().filter((r) => sectionOf(r.path) === section).map((r) => nameOf(r.path));

  async function move(path, section, now = new Date()) {
    if (running) throw { status: -1, error: 'sync in progress: try again in a moment' };
    const from = sectionOf(path);
    if (!SECTIONS.includes(section) || from === null) throw { status: -1, error: 'unknown section' };
    if (from === section) throw { status: -1, error: 'the file is already in this section' };
    const local = desk.get(path);
    if (!local) throw { status: -1, error: 'the file is no longer on this device' };
    running = true;
    try {
      return await relocate(path, from, section, local, now);
    } finally {
      running = false;
    }
  }

  async function relocate(path, from, section, local, now) {
    const toPublic = isPublic(section);
    const notUploaded = () => ({ status: -1, error: 'the copy must be uploaded first' });
    if (local.dirty || local.conflict) throw notUploaded();

    if (local.sha === null) {
      if (toPublic) throw notUploaded();
      const arrival = plainPath(section, uniqueSlug(nameOf(path), namesOnDesk(section)));
      const meta = withSection(local.meta, section);
      desk.put(arrival, { ...local, meta, pending: fileFromRecord({ ...local, meta }), dirty: false, conflict: null });
      desk.remove(path);
      return { slug: null, path: arrival };
    }

    if (local.pending !== null) throw notUploaded();
    if (toPublic && hasBrokenBlock(local.text)) {
      throw { status: -1, error: 'the text has lines of the time block: remove them before publishing' };
    }
    if (section === 'learn') {
      const problem = pillProblem(splitTitleBody(local.text).body);
      if (problem) throw { status: -1, error: problem };
    }
    if (section === 'post') {
      const tail = splitPills(splitTitleBody(local.text).body);
      if (tail.pills.length + tail.bad.length > 0) {
        const way = from === 'learn' ? ': move it to draft, remove them there, then publish it as post' : ', or publish it as learn';
        throw { status: -1, error: 'remove the pill: lines at the end before moving it to post' + way };
      }
    }
    const remote = await door('read', { path });
    if (remote.sha !== local.sha) throw { status: 409, error: 'the copy changed elsewhere: sync and try again' };
    const listing = await door('list');

    const { title, body } = splitTitleBody(local.text);
    const nameThere = (p) => (toPublic ? parsePublishedPath(p)?.slug : nameOf(p)) || null;
    const there = listing[FOLDER[section]].map((p) => ({ path: p.path, name: nameThere(p.path) })).filter((p) => p.name);

    let base, taken, finished = null;
    if (toPublic) {
      base = slugify(title);
      const kept = /^\d{4}-\d{2}-\d{2}/.test(local.times.finished || '') ? local.times.finished : null;
      finished = kept || localStamp(now);
      taken = [...(section === 'post' ? RESERVED_SLUGS : RESERVED_LEARN_SLUGS), ...there.map((p) => p.name)];
    } else {
      base = nameOf(path);
      taken = [...there.map((p) => p.name), ...namesOnDesk(section)];
    }

    let arrival = null;
    let slug = null;
    let content = null;
    let sha = null;
    for (const candidate of there.filter((p) => p.name === base || p.name.startsWith(base + '-'))) {
      const found = await door('read', { path: candidate.path });
      const parsed = parsePost(found.content);
      if (parsed.title === title && parsed.body === body) {
        arrival = candidate.path;
        slug = candidate.name;
        content = found.content;
        sha = found.sha;
        break;
      }
    }

    if (!arrival) {
      slug = uniqueSlug(base, taken);
      arrival = toPublic ? publishedPath(section, finished.slice(0, 10), slug) : plainPath(section, slug);
      const times = toPublic ? { ...local.times, finished } : local.times;
      content = fileFromRecord({ ...local, meta: withSection(local.meta, section), times });
      const message = section === 'post' ? 'publish ' + slug
        : section === 'learn' ? 'publish learn ' + slug
        : `move to ${SECTION_LABEL[section]}: ${slug}`;
      sha = (await door('write', { path: arrival, content, message })).sha;
    }

    const note = from === 'draft' && toPublic ? 'published as ' + slug : `moved to ${SECTION_LABEL[section]}: ${arrival}`;
    try {
      await door('delete', { path, sha: local.sha, message: note });
    } catch (e) {
      if (e.status !== 404 && isPublic(from)) {
        throw { status: e.status ?? -1, error: `copied to ${arrival}, but ${path} is still online: try again` };
      }
    }

    const after = desk.get(path);
    if (after && !after.dirty && after.pending === null) desk.remove(path);
    if (!toPublic) desk.fromRepo(arrival, content, sha);
    const published = desk.getPosts().filter((p) => p !== path && p !== arrival);
    desk.setPosts(toPublic ? [...published, arrival] : published);
    return { slug: toPublic ? slug : null, path: arrival };
  }

  async function publish(path, now = new Date(), section = 'post') {
    if (sectionOf(path) !== 'draft') throw { status: -1, error: 'only drafts can be published' };
    if (!isPublic(section)) throw { status: -1, error: 'a draft is published only as post or learn' };
    return move(path, section, now);
  }

  return { run, resolve, remove, publish, move };
}
