import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAUSE_MS, newTimes, tick, timesFromMeta, metaWithTimes, formatDuration,
  recordFromFile, fileFromRecord,
} from '../site/lib/post.js';

const T0 = Date.UTC(2026, 9, 3, 19, 14);
const MIN = 60_000;

test('the first keystroke opens the first session and sets the start', () => {
  const t = tick(newTimes(), T0);
  assert.equal(t.sessions, 1);
  assert.equal(t.writtenMs, 0);
  assert.match(t.started, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
});

test('two close keystrokes add up the gap', () => {
  const t = tick(tick(newTimes(), T0), T0 + 90_000);
  assert.equal(t.writtenMs, 90_000);
  assert.equal(t.sessions, 1);
});

test('exactly five minutes still count', () => {
  const t = tick(tick(newTimes(), T0), T0 + PAUSE_MS);
  assert.equal(t.writtenMs, PAUSE_MS);
  assert.equal(t.sessions, 1);
});

test('beyond five minutes: a new session, nothing added', () => {
  const t = tick(tick(newTimes(), T0), T0 + PAUSE_MS + 1);
  assert.equal(t.writtenMs, 0);
  assert.equal(t.sessions, 2);
});

test('if the clock goes back the gap is not added', () => {
  const t = tick(tick(newTimes(), T0), T0 - 2 * MIN);
  assert.equal(t.writtenMs, 0);
  assert.equal(t.sessions, 2);
  assert.equal(metaWithTimes({}, t).written, '0 min');
});

test('the start never changes again', () => {
  const first = tick(newTimes(), T0);
  assert.equal(tick(first, T0 + 60 * MIN).started, first.started);
});

test('tick does not change the state it receives', () => {
  const before = newTimes();
  tick(before, T0);
  assert.deepEqual(before, newTimes());
});

test('the times travel in the block and come back', () => {
  let t = tick(newTimes(), T0);
  t = tick(t, T0 + 4 * MIN);
  t = tick(t, T0 + 20 * MIN);
  t = tick(t, T0 + 22 * MIN);
  const meta = metaWithTimes({ note: 'x' }, t);
  assert.deepEqual(Object.keys(meta), ['started', 'written', 'sessions', 'note']);
  assert.equal(meta.written, '6 min');
  assert.equal(meta.sessions, '2');
  assert.equal(meta.note, 'x');
  const back = timesFromMeta(meta);
  assert.equal(back.started, t.started);
  assert.equal(back.writtenMs, 6 * MIN);
  assert.equal(back.sessions, 2);
  assert.equal(back.lastKeyAt, null);
});

test('opening the file again opens a new session', () => {
  const reopened = timesFromMeta({ started: '2026-10-03T21:14-05:00', written: '6 min', sessions: '2' });
  const t = tick(reopened, T0);
  assert.equal(t.sessions, 3);
  assert.equal(t.writtenMs, 6 * MIN);
});

test('"finished" goes in second place', () => {
  const t = { ...tick(newTimes(), T0), finished: '2026-10-05T08:02-05:00' };
  assert.deepEqual(Object.keys(metaWithTimes({}, t)), ['started', 'finished', 'written', 'sessions']);
});

test('without keystrokes no block is made', () => {
  assert.deepEqual(metaWithTimes({}, newTimes()), {});
  assert.deepEqual(metaWithTimes({ note: 'x' }, newTimes()), { note: 'x' });
});

test('readable durations', () => {
  assert.equal(formatDuration(0), '0 min');
  assert.equal(formatDuration(26 * MIN), '26 min');
  assert.equal(formatDuration(86 * MIN), '1 h 26 min');
});

test('from the file to the desk and back', () => {
  const file = 'Title\n\nBody.\n\n--\nstarted: 2026-10-03T21:14-05:00\nwritten: 6 min\nsessions: 2\n';
  const record = recordFromFile(file, 'abc');
  assert.equal(record.text, 'Title\n\nBody.');
  assert.equal(record.sha, 'abc');
  assert.equal(record.pending, null);
  assert.equal(record.dirty, false);
  assert.equal(record.conflict, null);
  assert.equal(record.times.sessions, 2);
  assert.equal(fileFromRecord(record), file);
});

test('a file written by hand stays without a block', () => {
  const record = recordFromFile('Title\n\nBody.\n', null);
  assert.equal(fileFromRecord(record), 'Title\n\nBody.\n');
});
