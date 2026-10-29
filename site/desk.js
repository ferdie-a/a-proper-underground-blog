import { newTimes, recordFromFile } from './lib/post.js';

const FILE = 'blog:file:';
const POSTS = 'blog:posts';
const PASSWORD = 'blog:password';
const OPEN = 'blog:open';
export const NEW = 'new';

const blank = () => ({ text: '', times: newTimes(), meta: {}, sha: null, pending: null, dirty: false, conflict: null, message: null });

export function createDesk(storage) {
  function get(path) {
    const raw = storage.getItem(FILE + path);
    return raw ? JSON.parse(raw) : null;
  }

  function put(path, record) {
    try { storage.setItem(FILE + path, JSON.stringify(record)); }
    catch { throw new Error('browser storage full'); }
  }

  function remove(path) { storage.removeItem(FILE + path); }

  function keys() {
    const out = [];
    for (let i = 0; i < storage.length; i++) out.push(storage.key(i));
    return out;
  }

  function list() {
    return keys().filter((k) => k.startsWith(FILE)).sort()
      .map((k) => ({ path: k.slice(FILE.length), ...JSON.parse(storage.getItem(k)) }));
  }

  return {
    get, put, remove, list,

    type(path, text, times) {
      put(path, { ...(get(path) || blank()), text, times, dirty: true });
    },

    save(path, text, times, content, message = null) {
      const r = get(path) || blank();
      put(path, { ...r, text, times, pending: content, dirty: false, message: message || r.message || null });
    },

    uploaded(path, sha, content, message = null) {
      const r = get(path);
      if (!r) return;
      const same = r.pending === content;
      const note = r.message ?? null;
      put(path, { ...r, sha, pending: same ? null : r.pending, message: same || note === message ? null : note });
    },

    fromRepo(path, content, sha, { force = false } = {}) {
      const r = get(path);
      if (!force && r && (r.dirty || r.pending !== null)) return false;
      put(path, recordFromFile(content, sha));
      return true;
    },

    setConflict(path, kind) {
      const r = get(path);
      if (r) put(path, { ...r, conflict: kind });
    },

    pendingCount() { return list().filter((r) => r.pending !== null).length; },

    getPosts() { return JSON.parse(storage.getItem(POSTS) || '[]'); },
    setPosts(paths) { storage.setItem(POSTS, JSON.stringify(paths)); },
    getPassword() { return storage.getItem(PASSWORD) || ''; },
    setPassword(password) { storage.setItem(PASSWORD, password); },
    getOpen() { return storage.getItem(OPEN) || NEW; },
    setOpen(path) { storage.setItem(OPEN, path); },

    clear() {
      for (const k of keys()) {
        if (k.startsWith(FILE) || k === POSTS || k === PASSWORD || k === OPEN) storage.removeItem(k);
      }
    },
  };
}
