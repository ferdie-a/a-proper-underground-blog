const SEPARATOR = '--';

const META_LINE = /^(\p{L}[\p{L}\p{N}_-]*):(?:[ \t]+(.*))?$/u;

const BOM = String.fromCharCode(0xfeff);

function normalize(raw) {
  const text = raw.startsWith(BOM) ? raw.slice(1) : raw;
  return text.replace(/\r\n?/g, '\n');
}

export function splitTitleBody(text) {
  const lines = normalize(text).split('\n');
  const first = lines.findIndex((line) => line.trim() !== '');
  if (first === -1) return { title: '', body: '' };
  const body = lines.slice(first + 1).join('\n').replace(/^\n+/, '').trimEnd();
  return { title: lines[first].trim(), body };
}

export function joinTitleBody(title, body) {
  return body ? `${title}\n\n${body}` : title;
}

export function parsePost(raw) {
  const lines = normalize(raw).split('\n');
  const meta = {};
  let content = lines;
  const sep = lines.findLastIndex((line) => line.trim() === SEPARATOR);
  if (sep !== -1) {
    const tail = lines.slice(sep + 1).filter((line) => line.trim() !== '');
    if (tail.length > 0 && tail.every((line) => META_LINE.test(line))) {
      for (const line of tail) {
        const [, key, value = ''] = line.match(META_LINE);
        meta[key] = value.trim();
      }
      content = lines.slice(0, sep);
    }
  }
  return { ...splitTitleBody(content.join('\n')), meta };
}

export const BLOCK_KEYS = ['started', 'finished', 'written', 'sessions', 'section'];

export function unknownKey(meta) {
  return Object.keys(meta).find((key) => !BLOCK_KEYS.includes(key)) ?? '';
}

export function serializePost({ title, body = '', meta = {} }) {
  let out = title.trim() + '\n';
  const text = normalize(body).replace(/^\n+/, '').trimEnd();
  if (text) out += '\n' + text + '\n';
  const keys = Object.keys(meta);
  if (keys.length > 0) {
    const rows = keys.map((key) => (meta[key] === '' ? `${key}:` : `${key}: ${meta[key]}`));
    out += '\n' + SEPARATOR + '\n' + rows.join('\n') + '\n';
  }
  return out;
}

const TIME_LINE = /^[^\S\n]*(?:(?:started|finished)\s*:\s*\d{4}-\d{2}-\d{2}|written\s*:\s*\d+\s*min\b|sessions\s*:\s*\d+[^\S\n]*$)/imu;

const STAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}[+-]\d{2}:\d{2}/;

export function hasBrokenBlock(body) {
  return TIME_LINE.test(body) || STAMP.test(body);
}

export const MIN_PILLS = 2;

const PILL_LINE = /^\s*pill:/i;

export function splitPills(body) {
  const lines = normalize(body).split('\n');
  let start = lines.length;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() === '') continue;
    if (!PILL_LINE.test(lines[i])) break;
    start = i;
  }
  let end = start;
  while (end > 0 && lines[end - 1].trim() === '') end--;
  const pills = [];
  const bad = [];
  for (const line of lines.slice(start)) {
    if (line.trim() === '') continue;
    const rest = line.replace(PILL_LINE, '');
    const bar = rest.indexOf('|');
    const question = (bar === -1 ? rest : rest.slice(0, bar)).trim();
    const answer = (bar === -1 ? '' : rest.slice(bar + 1)).trim();
    if (question && answer) pills.push({ question, answer });
    else bad.push(line.trim());
  }
  return { body: lines.slice(0, end).join('\n'), pills, bad };
}

export function pillProblem(body) {
  const { pills, bad } = splitPills(body);
  if (bad.length > 0) return `pill line without a question or an answer: ${bad[0]}`;
  if (pills.length < MIN_PILLS) return `a learn needs at least two "pill: question | answer" lines at the end of the text (found ${pills.length})`;
  return '';
}

export const RESERVED_SLUGS = [
  'index', '404', 'write', 'desk', 'sync', 'sw', 'theme', 'style', 'manifest',
  'api', 'lib', 'fonts', 'icons', 'favicon', 'learns',
];

export function slugify(title) {
  const slug = title
    .normalize('NFD').replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return slug || 'untitled';
}

export function uniqueSlug(base, taken) {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

export const SECTIONS = ['draft', 'idea', 'private', 'post', 'learn'];

export const FOLDER = { draft: 'drafts', idea: 'ideas', private: 'private', post: 'posts', learn: 'learns' };

export const SECTION_LABEL = { draft: 'draft', idea: 'idea', private: 'private', post: 'post', learn: 'learn' };

export function isPublic(section) {
  return section === 'post' || section === 'learn';
}

export function sectionOf(path) {
  const m = /^([^/]+)\/[^/]+$/.exec(path);
  return (m && SECTIONS.find((section) => FOLDER[section] === m[1])) || null;
}

export function withSection(meta, section) {
  if (section !== 'draft') return { ...meta, section };
  const { section: dropped, ...rest } = meta;
  return rest;
}

export function draftPath(slug, fork = '') {
  return `drafts/${slug}${fork ? '--' + fork : ''}.txt`;
}

export function plainPath(section, name) {
  if (!SECTIONS.includes(section) || isPublic(section)) throw new Error(`section "${section}" has no undated paths`);
  return `${FOLDER[section]}/${name}.txt`;
}

export function publishedPath(section, date, slug) {
  if (!isPublic(section)) throw new Error(`section "${section}" is not published`);
  return `${FOLDER[section]}/${date}-${slug}.txt`;
}

const PUBLISHED_PATH = /^(posts|learns)\/(\d{4}-\d{2}-\d{2})-([a-z0-9-]+)\.txt$/;

export function parsePublishedPath(path) {
  const m = PUBLISHED_PATH.exec(path);
  return m ? { section: sectionOf(path), date: m[2], slug: m[3] } : null;
}

export function postPath(date, slug) {
  return publishedPath('post', date, slug);
}

export function parsePostPath(path) {
  const found = parsePublishedPath(path);
  return found?.section === 'post' ? { date: found.date, slug: found.slug } : null;
}

export function parseDraftPath(path) {
  const m = /^drafts\/([a-z0-9-]+?)(?:--([a-z0-9-]+))?\.txt$/.exec(path);
  return m ? { slug: m[1], fork: m[2] || '' } : null;
}

const fileName = (path) => path.replace(/^[^/]*[/]/, '').replace(/\.txt$/, '');

export function nameOf(path) {
  const published = parsePublishedPath(path);
  return published ? published.slug : fileName(path);
}

export function titleFromSlug(slug) {
  return slug.split('-').filter((part) => part !== '').join(' ');
}

const DOTS = String.fromCharCode(8230);

export function clipTitle(title, max = 60) {
  const chars = Array.from(title);
  return chars.length <= max ? title : chars.slice(0, max).join('') + DOTS;
}

const NO_TITLE = '(untitled)';
const shownTitle = (title) => clipTitle(title || NO_TITLE);

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
const startOf = (r) => {
  const ms = Date.parse(r.times?.started ?? '');
  return Number.isNaN(ms) ? -Infinity : ms;
};
const byStart = (a, b) => (startOf(b) - startOf(a)) || byName(a, b);

export function draftRows(records) {
  const row = (record, name, fork) => ({ ...record, name, title: splitTitleBody(record.text).title, fork });
  const whole = (path) => path.replace(/^drafts[/]/, '').replace(/\.txt$/, '');
  const items = records.map((record) => ({ record, ...(parseDraftPath(record.path) || { slug: whole(record.path), fork: '' }) }));
  const drafts = new Set(items.filter((i) => !i.fork).map((i) => i.slug));
  const top = items.filter((i) => !i.fork || !drafts.has(i.slug)).map((i) => row(i.record, whole(i.record.path), false));
  const forksOf = (slug) => items.filter((i) => i.fork && i.slug === slug).map((i) => row(i.record, i.fork, true));
  return top.sort(byStart).flatMap((t) => [t, ...(drafts.has(t.name) ? forksOf(t.name).sort(byName) : [])]);
}

export function fileRows(records, published) {
  const inSection = (section) => records.filter((r) => sectionOf(r.path) === section);
  const drafts = draftRows(inSection('draft')).map((r) => ({
    path: r.path, label: SECTION_LABEL.draft, title: shownTitle(r.title), fork: r.fork, ...(r.fork ? { forkName: r.name } : {}),
  }));
  const plain = ['idea', 'private'].flatMap((section) => inSection(section)
    .map((r) => ({ ...r, name: nameOf(r.path) }))
    .sort(byStart)
    .map((r) => ({ path: r.path, label: SECTION_LABEL[section], title: shownTitle(splitTitleBody(r.text).title), fork: false })));
  const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const onDesk = new Map(records.map((r) => [r.path, r]));
  const online = [...published]
    .map((path) => ({ path, name: fileName(path) }))
    .sort((a, b) => byName(b, a) || byPath(a, b))
    .map(({ path }) => {
      const local = onDesk.get(path);
      const title = local ? splitTitleBody(local.text).title : titleFromSlug(nameOf(path));
      return { path, label: SECTION_LABEL[sectionOf(path)], title: shownTitle(title), fork: false };
    });
  return [...drafts, ...plain, ...online];
}

const two = (n) => String(n).padStart(2, '0');

export function localDate(d) {
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

export function localStamp(d) {
  const east = -d.getTimezoneOffset();
  const abs = Math.abs(east);
  const zone = `${east >= 0 ? '+' : '-'}${two(Math.floor(abs / 60))}:${two(abs % 60)}`;
  return `${localDate(d)}T${two(d.getHours())}:${two(d.getMinutes())}${zone}`;
}

export function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const URL_RE = /https?:\/\/(?:(?!&lt;|&gt;|&quot;)\S)+/g;
const TRAILING = ".,;:!?)]'";

export function renderBody(body) {
  return escapeHtml(body).replace(URL_RE, (hit) => {
    let end = hit.length;
    for (;;) {
      if (hit.endsWith('&amp;', end)) end -= 5;
      else if (end > 0 && TRAILING.includes(hit[end - 1])) end -= 1;
      else break;
    }
    const url = hit.slice(0, end);
    const tail = hit.slice(end);
    if (!/^https?:\/\/[^/]/.test(url)) return hit;
    return `<a href="${url}" rel="noopener">${url}</a>${tail}`;
  });
}

export const PAUSE_MS = 5 * 60 * 1000;

export function newTimes() {
  return { started: null, finished: null, writtenMs: 0, sessions: 0, lastKeyAt: null };
}

export function tick(times, now) {
  const t = { ...times };
  if (t.started === null) t.started = localStamp(new Date(now));
  const gap = t.lastKeyAt === null ? null : now - t.lastKeyAt;
  if (gap === null || gap > PAUSE_MS || gap < 0) t.sessions += 1;
  else t.writtenMs += gap;
  t.lastKeyAt = now;
  return t;
}

export function timesFromMeta(meta) {
  return {
    started: meta.started || null,
    finished: meta.finished || null,
    writtenMs: (parseInt(meta.written, 10) || 0) * 60000,
    sessions: parseInt(meta.sessions, 10) || 0,
    lastKeyAt: null,
  };
}

export function metaWithTimes(meta, times) {
  const { started, finished, written, sessions, ...other } = meta;
  if (times.started === null) return other;
  const out = { started: times.started };
  if (times.finished) out.finished = times.finished;
  out.written = `${Math.round(times.writtenMs / 60000)} min`;
  out.sessions = String(times.sessions);
  return { ...out, ...other };
}

export function formatDuration(ms) {
  const min = Math.round(ms / 60000);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

export function recordFromFile(content, sha) {
  const { title, body, meta } = parsePost(content);
  return {
    text: joinTitleBody(title, body),
    times: timesFromMeta(meta),
    meta,
    sha,
    pending: null,
    dirty: false,
    conflict: null,
    message: null,
  };
}

export function fileFromRecord(record) {
  const { title, body } = splitTitleBody(record.text);
  return serializePost({ title, body, meta: metaWithTimes(record.meta, record.times) });
}
