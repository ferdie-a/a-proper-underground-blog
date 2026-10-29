import { createDesk, NEW } from './desk.js';
import { createSync, doorClient } from './sync.js';
import {
  newTimes, tick, fileFromRecord, parsePost, splitTitleBody, joinTitleBody,
  slugify, uniqueSlug, draftPath, parseDraftPath, formatDuration, localDate,
  SECTIONS, SECTION_LABEL, isPublic, sectionOf, nameOf, plainPath, parsePublishedPath, withSection, fileRows,
} from './lib/post.js';

const $ = (id) => document.getElementById(id);
const textarea = $('text');
const listBox = $('list');
const cmds = $('cmds');
const statusBox = $('status');

const DEMO = document.querySelector('meta[name="demo"]')?.getAttribute('content') === '1';
const DEMO_NOTE = 'demo: saving is off';

const desk = createDesk(localStorage);
const door = DEMO
  ? async () => { throw { status: 403, error: DEMO_NOTE }; }
  : doorClient(() => desk.getPassword());
const sync = createSync({ desk, door });

let path = NEW;
let times = newTimes();
let note = '';
let asking = false;
let timer = null;
let resolving = false;
let unsafe = false;
let shared = null;
let holds = 0;

const isDraft = () => path.startsWith('drafts/');
const onMain = () => isPublic(sectionOf(path));
const offline = (e) => e.status === 0;
const reason = (e) => e.error || e.message || String(e);
const when = (stamp) => new Date(stamp).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const STATE = { draft: 'draft', idea: 'idea', private: 'private', post: 'published post', learn: 'published learn' };
const ONE = { draft: 'a draft', idea: 'an idea', private: 'a private file', post: 'a post', learn: 'a learn' };

function namesIn(section) {
  if (section === 'draft') return desk.list().map((r) => parseDraftPath(r.path)).filter(Boolean).map((d) => d.slug);
  return desk.list().filter((r) => sectionOf(r.path) === section).map((r) => nameOf(r.path));
}

function show(what) {
  textarea.hidden = what !== 'text';
  listBox.hidden = what !== 'list';
  if (what === 'text') textarea.focus();
}

function button(label, action) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', action);
  return b;
}

function render() {
  const r = desk.get(path);
  const waiting = desk.pendingCount();
  const parts = [
    STATE[sectionOf(path)] || STATE.draft,
    DEMO ? DEMO_NOTE : '',
    unsafe ? 'unsaved' : !r ? '' : r.dirty ? 'unsaved' : r.pending !== null ? 'saved on this device' : r.sha ? 'saved' : '',
    times.started ? `started ${when(times.started)} · written ${formatDuration(times.writtenMs)} · ${times.sessions} ${times.sessions === 1 ? 'session' : 'sessions'}` : '',
    navigator.onLine ? '' : 'offline',
    waiting ? `to upload: ${waiting}` : 'all uploaded',
    unsafe ? 'browser storage full: the text is only here on screen' : '',
    shared === path ? 'this file is also open in another tab: use only one' : '',
    note,
  ];
  if (!asking) statusBox.textContent = [...new Set(parts.filter(Boolean))].join(' · ');
  const names = asking ? [] : Object.keys(COMMANDS).filter((n) => isDraft() || n !== 'publish');
  cmds.replaceChildren(...names.map((n) => button(n, COMMANDS[n])));
}

function ask(text, answers, { focus = null, cancel = null } = {}) {
  return new Promise((resolve) => {
    asking = true;
    const done = (answer) => {
      document.removeEventListener('keydown', onKey);
      asking = false;
      resolve(answer);
      render();
      if (focus !== null && !textarea.hidden) textarea.focus();
    };
    const onKey = (e) => {
      if (e.key !== 'Escape' || cancel === null) return;
      e.preventDefault();
      done(cancel);
    };
    const buttons = answers.map((a) => button(a, () => done(a)));
    statusBox.replaceChildren(text, ...buttons.flatMap((b, i) => [i ? ' · ' : ' ', b]));
    document.addEventListener('keydown', onKey);
    render();
    if (focus !== null) buttons[answers.indexOf(focus)]?.focus();
  });
}

function askText(label, { type = 'text', value = '', max = 0 } = {}) {
  return new Promise((resolve) => {
    asking = true;
    const input = document.createElement('input');
    input.type = type;
    input.value = value;
    if (max) input.maxLength = max;
    input.autocomplete = 'off';
    input.autocapitalize = 'off';
    const done = (answer) => { asking = false; resolve(answer.trim()); render(); textarea.focus(); };
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== 'Escape') return;
      e.preventDefault();
      done(e.key === 'Enter' ? input.value : '');
    });
    statusBox.replaceChildren(label + ' ', input, ' ', button('ok', () => done(input.value)), ' · ', button('cancel', () => done('')));
    render();
    input.focus();
    if (value) input.select();
  });
}

function open(p) {
  flush();
  if (unsafe) copy();
  if (unsafe) { show('text'); return render(); }
  const r = desk.get(p);
  path = p;
  times = r ? { ...r.times, lastKeyAt: null } : newTimes();
  textarea.value = r ? r.text : '';
  textarea.readOnly = false;
  try { desk.setOpen(p); } catch {}
  note = '';
  show('text');
  render();
}

function flush() {
  if (timer === null) return;
  clearTimeout(timer);
  timer = null;
  copy();
}

function copy() {
  try { desk.type(path, textarea.value, times); unsafe = false; } catch { unsafe = true; }
  render();
}

function refresh() {
  if (asking) return;
  if (unsafe) return;
  const r = desk.get(path);
  if (path !== NEW && !r) {
    if (timer !== null) return flush();
    return open(NEW);
  }
  if (r && !r.dirty && timer === null && !textarea.readOnly && r.text !== textarea.value) {
    textarea.value = r.text;
    times = { ...r.times, lastKeyAt: null };
  }
}

async function align() {
  if (DEMO) return render();
  if (!desk.getPassword()) {
    if (!asking) askPassword();
    return;
  }
  flush();
  const out = await sync.run();
  if (out.status === 401) {
    desk.setPassword('');
    note = 'wrong password';
    if (asking) return render();
    return askPassword();
  }
  if (!out.ok && !offline(out)) note = out.error;
  if (note === STILL_LOADING && (desk.get(path)?.pending ?? null) === null) note = '';
  refresh();
  render();
  askAboutConflicts();
}

function cannotSave() {
  if (!textarea.value.trim()) return 'nothing to save';
  if (onMain() && !navigator.onLine) return 'published pieces can only be edited online';
  return '';
}

async function askName(section = 'draft') {
  copy();
  const proposal = uniqueSlug(slugify(splitTitleBody(textarea.value).title), namesIn(section));
  const raw = await askText('file name:', { value: proposal });
  if (!raw || path !== NEW) return null;
  const name = slugify(raw);
  if (namesIn(section).includes(name)) { note = 'name already used'; return null; }
  return plainPath(section, name);
}

async function save(message = '', section = 'draft') {
  if (textarea.readOnly) return render();
  let target = path;
  if (path === NEW && !cannotSave()) {
    note = '';
    target = await askName(section);
    if (!target) return render();
  }
  clearTimeout(timer);
  timer = null;
  const text = textarea.value;
  const stop = cannotSave();
  if (stop) { note = stop; return render(); }
  try {
    const first = path === NEW;
    if (first) {
      const meta = withSection({}, section);
      desk.put(target, {
        text, times, meta, sha: null, pending: fileFromRecord({ text, times, meta }),
        dirty: false, conflict: null, message: message || null,
      });
    } else {
      const meta = desk.get(target)?.meta || {};
      desk.save(target, text, times, fileFromRecord({ text, times, meta }), message);
    }
    unsafe = false;
    if (first) desk.remove(NEW);
    path = target;
    try { desk.setOpen(path); } catch {}
    note = '';
    if (first) show('text');
  } catch (e) {
    unsafe = true;
    note = reason(e);
    return render();
  }
  render();
  await align();
}

async function version() {
  const stop = cannotSave();
  if (stop) { note = stop; return render(); }
  const target = path;
  const label = await askText('note:', { max: 100 });
  if (!label || path !== target) return render();
  await save(label);
}

async function fork() {
  flush();
  if (!textarea.value.trim()) { note = 'nothing to make a variant from'; return render(); }
  const raw = await askText('variant name:');
  if (!raw) return;
  const target = draftPath(parseDraftPath(path).slug, slugify(raw));
  if (desk.get(target)) { note = 'name already used'; return render(); }
  const text = textarea.value;
  try { desk.save(target, text, times, fileFromRecord({ text, times, meta: desk.get(path)?.meta || {} })); }
  catch (e) { note = reason(e); return render(); }
  open(target);
  await align();
}

async function versions() {
  flush();
  if (!desk.get(path)?.sha) { note = 'no uploaded save yet'; return render(); }
  try {
    const { versions: found } = await door('history', { path });
    const rows = found.map((v) => button(`${when(v.date)}  ${v.message}`, () => { if (!asking) view(v.ref); }));
    listBox.replaceChildren(button('back', () => show('text')), ...rows);
    show('list');
  } catch (e) { note = offline(e) ? 'history needs the network' : reason(e); render(); }
}

async function view(ref) {
  const target = path;
  try {
    const old = parsePost((await door('read', { path: target, ref })).content);
    if (path !== target) return;
    if (asking) return;
    flush();
    const current = textarea.value;
    textarea.value = joinTitleBody(old.title, old.body);
    textarea.readOnly = true;
    show('text');
    const answer = await ask('past save:', ['restore', 'back']);
    textarea.readOnly = false;
    if (answer === 'restore') copy();
    else textarea.value = current;
  } catch (e) { note = offline(e) ? 'history needs the network' : reason(e); }
  render();
}

async function erase() {
  const target = path;
  const section = sectionOf(target);
  if (section === null) return;
  if (resolving) { note = 'a conflict choice is on its way: try again in a moment'; return render(); }
  const name = nameOf(target);
  if (isPublic(section)) {
    const title = splitTitleBody(textarea.value).title || name;
    return moveOff(target, 'private', `take "${title}" off the site and move it to private?`);
  }
  if ((await ask(`delete ${name}?`, ['yes', 'no'], { cancel: 'no' })) !== 'yes') return;
  if (path !== target) return;
  const local = desk.get(target);
  const twin = local !== null && local.sha === null && Boolean(local.conflict);
  try {
    await sync.remove(target);
    if (path === target) {
      clearTimeout(timer);
      timer = null;
      unsafe = false;
      open(NEW);
    }
    note = twin ? `deleted the copy on this device: the repo already has ${ONE[section]} named ${name}` : `deleted: ${name}`;
  } catch (e) {
    if (e.status === 409) {
      await align();
      const now = desk.get(target);
      note = now && (now.dirty || now.pending !== null)
        ? `${name} changed elsewhere and has edits here: save, choose which to keep, then delete`
        : `${name} changed elsewhere: this is the new version, not deleted`;
    } else {
      note = offline(e) ? 'deleting an uploaded file needs the network' : reason(e);
    }
    return render();
  }
  render();
  await align();
}

function moveTrouble(e, offlineText) {
  const text = reason(e);
  if (!text.startsWith('copied to ')) return offline(e) || !navigator.onLine ? offlineText : text;
  return e.status === 409 ? `${text} (it changed elsewhere: trying again leaves two copies, the old one and the new one)` : text;
}

async function publish(section) {
  const target = path;
  const from = sectionOf(target);
  if (from === null || from === section || (!section && isPublic(from))) return;
  if (timer !== null || desk.get(target)?.dirty) await save();
  if (!navigator.onLine) { note = 'publishing needs the network'; return render(); }
  await align();
  if (asking || path !== target) return;
  const title = splitTitleBody(textarea.value).title || 'untitled';
  let to = section;
  if (!to) {
    const answer = await ask(`publish "${title}" as:`, [SECTION_LABEL.post, SECTION_LABEL.learn, 'no'], { focus: SECTION_LABEL.post, cancel: 'no' });
    to = SECTIONS.find((s) => isPublic(s) && SECTION_LABEL[s] === answer);
    if (!to) return;
  } else {
    const question = isPublic(from)
      ? `move "${title}" from ${SECTION_LABEL[from]} to ${SECTION_LABEL[to]}? the old address stops working`
      : `publish "${title}" as ${SECTION_LABEL[to]}?`;
    if ((await ask(question, ['yes', 'no'], { cancel: 'no' })) !== 'yes') return;
  }
  if (path !== target) return;
  if (DEMO) { note = DEMO_NOTE; return render(); }
  const now = new Date();
  textarea.readOnly = true;
  let out;
  try {
    out = await sync.move(target, to, now);
  } catch (e) {
    note = moveTrouble(e, 'publishing needs the network');
    return render();
  } finally {
    if (path === target) textarea.readOnly = false;
  }
  if (path === target && !desk.get(target)) open(NEW);
  const date = parsePublishedPath(out.path)?.date;
  const kept = date && date !== localDate(now) ? ` (keeps its date: ${date})` : '';
  note = `published: /${to === 'learn' ? 'learns/' : ''}${out.slug}${kept}`;
  render();
}

async function moveOff(target, section, question = '') {
  const down = isPublic(sectionOf(target));
  if (down) holds++;
  try {
    return await moveAway(target, section, question);
  } finally {
    if (down) holds--;
  }
}

async function moveAway(target, section, question) {
  flush();
  if (unsafe) return render();
  const label = SECTION_LABEL[section];
  const down = isPublic(sectionOf(target));
  if (down && !navigator.onLine) { note = 'taking a piece off the site needs the network'; return render(); }
  if (question && (await ask(question, ['yes', 'no'], { cancel: 'no' })) !== 'yes') return;
  if (path !== target) return;
  flush();
  if (desk.get(target)?.conflict) {
    note = 'this file has a conflict: first choose which version to keep';
    render();
    return askAboutConflicts();
  }

  let edits = null;
  if (!down) {
    if (timer !== null || desk.get(target)?.dirty) await save();
    await align();
  } else {
    if (desk.get(target)?.pending === null) await align();
    if (asking || path !== target) return;
    flush();
    const local = desk.get(target);
    if (local && (local.dirty || local.pending !== null)) {
      const title = splitTitleBody(local.text).title || nameOf(target);
      const keep = `keep them, only in ${label}`;
      const answer = await ask(`"${title}" has edits that are not online:`, [keep, 'drop them', 'cancel'], { cancel: 'cancel' });
      if (answer === 'cancel') return;
      edits = answer === keep ? 'keep' : 'drop';
    }
  }
  if (asking || path !== target) return;
  flush();

  textarea.readOnly = true;
  let snapshot = null;
  let out;
  try {
    if (edits === 'drop') {
      const found = await door('read', { path: target });
      desk.fromRepo(target, found.content, found.sha, { force: true });
      const r = desk.get(target);
      textarea.value = r.text;
      times = { ...r.times, lastKeyAt: null };
    } else if (edits === 'keep') {
      snapshot = desk.get(target);
      desk.put(target, { ...snapshot, pending: null, dirty: false, message: null });
    }
    out = await sync.move(target, section, new Date());
  } catch (e) {
    if (snapshot) desk.put(target, { ...snapshot, pending: null, dirty: true });
    note = snapshot && e.status === 409 && !reason(e).startsWith('copied to ')
      ? `${nameOf(target)} changed elsewhere and has edits here: save, choose which version to keep, then try again`
      : moveTrouble(e, down ? 'taking a piece off the site needs the network' : 'moving an uploaded file needs the network');
    return render();
  } finally {
    if (path === target) textarea.readOnly = false;
  }
  if (path === target) open(out.path);
  note = down ? `off the site, now in ${label}: ${nameOf(out.path)}` : `moved to ${label}: ${nameOf(out.path)}`;
  render();
  await align();
}

async function moveTo() {
  flush();
  const target = path;
  const from = sectionOf(target);
  const stop = from === null ? cannotSave() : '';
  if (stop) { note = stop; return render(); }
  const held = isPublic(from);
  if (held) holds++;
  try {
    const labels = SECTIONS.filter((s) => s !== (from ?? 'draft')).map((s) => SECTION_LABEL[s]);
    const answer = await ask('move to:', [...labels, 'cancel'], { cancel: 'cancel' });
    const section = SECTIONS.find((s) => SECTION_LABEL[s] === answer);
    if (!section || path !== target) return;
    if (from === null) {
      if (!isPublic(section)) return await save('', section);
      await save();
      if (path === NEW) return;
      return await publish(section);
    }
    if (isPublic(section)) return await publish(section);
    return await moveOff(target, section);
  } finally {
    if (held) holds--;
  }
}

function files() {
  flush();
  const mark = (r) => !r ? '' : r.conflict ? '(conflict)' : r.pending !== null ? '(to upload)' : r.dirty ? '(unsaved)' : '';
  const rows = fileRows(desk.list(), desk.getPosts()).map((r) => {
    const m = mark(desk.get(r.path));
    const flag = m ? m + '  ' : '';
    const text = r.fork ? ' '.repeat(10) + r.forkName + '  ' + flag + r.title : r.label.padEnd(8) + flag + r.title;
    const go = isPublic(sectionOf(r.path)) ? openPublished : open;
    return button(text, () => { if (!asking) go(r.path); });
  });
  const sheet = desk.get(NEW)?.text.trim() ? [button('unsaved sheet', () => { if (!asking) open(NEW); })] : [];
  listBox.replaceChildren(button('back', () => show('text')), ...sheet, ...rows);
  show('list');
}

async function openPublished(p) {
  const local = desk.get(p);
  if (!local || (!local.dirty && local.pending === null)) {
    try {
      const found = await door('read', { path: p });
      desk.fromRepo(p, found.content, found.sha);
    } catch (e) {
      note = offline(e) ? 'opening a published piece needs the network' : reason(e);
      show('text');
      return render();
    }
  }
  open(p);
}

async function fresh() {
  flush();
  if (path !== NEW) return open(NEW);
  if (textarea.value.trim()) {
    if ((await ask('this sheet is not saved: throw it away?', ['yes', 'no'])) !== 'yes') return;
    if (path !== NEW) return;
    unsafe = false;
  }
  desk.remove(NEW);
  open(NEW);
}

async function leave() {
  flush();
  const waiting = desk.list().filter((r) => r.pending !== null || r.dirty).length;
  const text = waiting
    ? `${waiting} ${waiting === 1 ? 'file is' : 'files are'} not uploaded: sign out anyway?`
    : 'sign out and delete the copies on this device?';
  if ((await ask(text, ['yes', 'no'])) !== 'yes') return;
  desk.clear();
  location.reload();
}

const STILL_LOADING = 'still uploading, try again in a moment';
function site() {
  const r = desk.get(path);
  if (holds > 0 || textarea.readOnly || (r && r.pending !== null)) {
    note = STILL_LOADING;
    return render();
  }
  flush();
  if (unsafe) copy();
  if (unsafe) return render();
  const found = onMain() ? parsePublishedPath(path) : null;
  const target = !found ? '/' : found.section === 'learn' ? `/learns/${found.slug}` : `/${found.slug}`;
  location.assign(target);
}

function more() {
  flush();
  const named = sectionOf(path) !== null;
  const rows = MORE.filter(([name]) => (name !== 'variant' || isDraft()) && (name !== 'delete' || named))
    .map(([name, hint, action]) => {
      const row = button(name, () => { if (asking) return; show('text'); action(); });
      const text = document.createElement('span');
      text.textContent = hint;
      row.append(text);
      row.className = 'cmd';
      return row;
    });
  listBox.replaceChildren(button('back', () => show('text')), ...rows);
  show('list');
}

const COMMANDS = { save: () => save(), files, new: fresh, publish: () => publish(), more };

const MORE = [
  ['save with note', 'saves and names this point, to find it again in history', version],
  ['history', 'the saves of this file: read an old one and restore it', versions],
  ['move to…', 'moves this file: draft, idea, private, post or learn', moveTo],
  ['site', 'opens the public page of the open piece, or the home page', site],
  ['variant', 'a second version of this draft, to try another way', fork],
  ['delete', 'throws this file away (variants stay); a published piece goes off the site into private', erase],
  ['sign out', 'forgets the password and the copies on this device', leave],
];

const AS_VARIANT = 'make it a variant';
const OTHER_NAME = 'keep it under another name';
const MINE_ONLINE = 'keep mine and put it online';
const AS_DRAFT = 'make it a draft';
const BACK_ONLINE = 'put it back online';

function keepAsDraft(from) {
  const local = desk.get(from);
  if (!local) throw { status: -1, error: 'the file is no longer on this device' };
  const target = draftPath(uniqueSlug(nameOf(from), namesIn('draft')));
  const meta = withSection(local.meta, 'draft');
  desk.put(target, { ...local, meta, sha: null, pending: fileFromRecord({ ...local, meta }), dirty: false, conflict: null });
  desk.remove(from);
  return target;
}

async function otherPath(from, section) {
  if (section === 'draft') {
    const raw = await askText('variant name:');
    return raw ? draftPath(parseDraftPath(from).slug, slugify(raw)) : null;
  }
  const raw = await askText('file name:', { value: uniqueSlug(nameOf(from), namesIn(section)) });
  return raw ? plainPath(section, slugify(raw)) : null;
}

async function askAboutConflicts() {
  if (asking || resolving) return;
  flush();
  const c = desk.list().find((r) => r.conflict);
  if (!c) return;
  const section = sectionOf(c.path);
  const name = nameOf(c.path);
  const online = isPublic(section);
  const onOpenFile = c.path === path;
  if (onOpenFile) textarea.readOnly = true;
  let again = false;
  let done = '';
  resolving = true;
  try {
    if (c.conflict === 'gone' && online) {
      const answer = await ask(`${name} was taken off the site or moved by another device, but has an edit here:`, [AS_DRAFT, BACK_ONLINE, 'discard']);
      if (answer === AS_DRAFT) {
        const draft = keepAsDraft(c.path);
        if (path === c.path) open(draft);
        done = 'the edit is now a draft: ' + nameOf(draft);
      } else if (answer === BACK_ONLINE) {
        await sync.resolve(c.path, 'reupload');
        done = `back online: ${name}; the copy moved elsewhere stays where it is`;
      } else {
        await sync.resolve(c.path, 'discard');
      }
    } else if (c.conflict === 'gone') {
      const answer = await ask(`${name} no longer exists on the repo:`, [section === 'draft' ? 'upload again as draft' : 'upload it again', 'discard']);
      await sync.resolve(c.path, answer === 'discard' ? 'discard' : 'reupload');
    } else {
      const neverUploaded = !online && c.sha === null;
      const both = section === 'draft' ? AS_VARIANT : online ? null : OTHER_NAME;
      const mine = online ? MINE_ONLINE : 'keep mine';
      const choices = (neverUploaded ? [mine, both] : [mine, 'keep the other', both]).filter(Boolean);
      const question = neverUploaded ? `the repo already has ${ONE[section]} named ${name}:` : `conflict on ${name}:`;
      const answer = await ask(question, choices);
      if (answer === both) {
        const target = await otherPath(c.path, section);
        if (!target) return;
        if (desk.get(target)) { note = 'name already used'; return; }
        await sync.resolve(c.path, 'fork', target);
      } else {
        await sync.resolve(c.path, answer === mine ? 'mine' : 'theirs');
      }
    }
    if (desk.get(c.path)?.conflict) note = 'the file changed while you were choosing: save and choose again';
    else { note = done; again = true; }
  } catch (e) {
    note = offline(e) ? 'resolving needs the network' : reason(e);
  } finally {
    resolving = false;
    if (onOpenFile) textarea.readOnly = false;
    refresh();
    render();
  }
  if (again) askAboutConflicts();
}

async function askPassword() {
  textarea.readOnly = true;
  show('text');
  const password = await askText((note ? note + ' · ' : '') + 'password:', { type: 'password' });
  note = '';
  textarea.readOnly = false;
  if (!password) { if (asking) return; return askPassword(); }
  desk.setPassword(password);
  const out = await sync.run();
  if (out.status === 401) { desk.setPassword(''); note = 'wrong password'; if (asking) return render(); return askPassword(); }
  if (!out.ok) note = offline(out) ? 'the first time needs the network' : out.error;
  start();
}

function start() {
  const last = desk.getOpen();
  const keep = note;
  open(last !== NEW && !desk.get(last) ? NEW : last);
  note = keep;
  render();
  askAboutConflicts();
}

textarea.addEventListener('input', () => {
  if (textarea.readOnly) return;
  if (!onMain()) times = tick(times, Date.now());
  if (timer === null) {
    copy();
    timer = setTimeout(flush, 1000);
  }
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (!asking) save(); }
});

window.addEventListener('online', () => (holds ? render() : align()));
window.addEventListener('offline', render);
window.addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });

window.addEventListener('storage', (e) => {
  if (e.key === 'blog:file:' + path) { shared = path; render(); }
});

setInterval(() => {
  if (holds) return;
  const files = desk.list();
  if (navigator.onLine && files.some((r) => r.pending !== null && !r.conflict)) align();
  else if (navigator.onLine && !asking && files.some((r) => r.conflict)) askAboutConflicts();
}, 30000);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

if (DEMO) start();
else if (desk.getPassword()) { start(); align(); }
else askPassword();
