import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePost, serializePost, splitTitleBody, joinTitleBody, hasBrokenBlock, splitPills, pillProblem, BLOCK_KEYS, unknownKey,
} from '../site/lib/post.js';

const FILE = `Title of the post

First line.
Second line.

--
started: 2026-10-03T21:14-05:00
written: 86 min
sessions: 3
`;

test('reads title, body and block', () => {
  const p = parsePost(FILE);
  assert.equal(p.title, 'Title of the post');
  assert.equal(p.body, 'First line.\nSecond line.');
  assert.deepEqual(p.meta, { started: '2026-10-03T21:14-05:00', written: '86 min', sessions: '3' });
});

test('the time block keys are started, finished, written, sessions and section', () => {
  assert.deepEqual(BLOCK_KEYS, ['started', 'finished', 'written', 'sessions', 'section']);
});

test('unknownKey names the first key of a block that is not one of the five, or gives an empty string', () => {
  assert.equal(unknownKey(parsePost(FILE).meta), '');
  assert.equal(unknownKey({}), '');
  const all = 'T\n\nc\n\n--\nstarted: 2026-10-03T21:14-05:00\nfinished: 2026-10-05T08:02-05:00\nwritten: 86 min\nsessions: 3\nsection: post\n';
  assert.equal(unknownKey(parsePost(all).meta), '');
  const other = 'T\n\nc\n\n--\nmood: happy\nstarted: 2026-10-03T21:14-05:00\nwritten: 86 min\nsessions: 3\n';
  assert.equal(unknownKey(parsePost(other).meta), 'mood');
  assert.equal(unknownKey(parsePost('T\n\nc\n\n--\nsessions: 2\nweather: rain\n').meta), 'weather');
});

test('reading and writing again gives the same file', () => {
  assert.equal(serializePost(parsePost(FILE)), FILE);
});

test('accepts Windows line ends and the byte order mark of Notepad', () => {
  const windows = String.fromCharCode(0xfeff) + FILE.replace(/\n/g, '\r\n');
  assert.deepEqual(parsePost(windows), parsePost(FILE));
});

test('file without a block', () => {
  const p = parsePost('Only a title\n\nBody.\n');
  assert.deepEqual(p, { title: 'Only a title', body: 'Body.', meta: {} });
  assert.equal(serializePost(p), 'Only a title\n\nBody.\n');
});

test('only the title', () => {
  assert.deepEqual(parsePost('Only a title'), { title: 'Only a title', body: '', meta: {} });
  assert.equal(serializePost({ title: 'Only a title' }), 'Only a title\n');
});

test('empty file', () => {
  assert.deepEqual(parsePost(''), { title: '', body: '', meta: {} });
});

test('the indent of code at the top of the body stays', () => {
  assert.equal(parsePost('T\n\n    code()\nend\n').body, '    code()\nend');
});

test('a "--" in the body is not a block', () => {
  const p = parsePost('T\n\nabove\n--\nbelow, plain text\n');
  assert.equal(p.body, 'above\n--\nbelow, plain text');
  assert.deepEqual(p.meta, {});
});

test('a "--" at the end, used as a signature, stays text', () => {
  assert.equal(parsePost('T\n\nbody\n--\n').body, 'body\n--');
});

test('a web address after "--" is not a key', () => {
  const p = parsePost('T\n\nbody\n--\nhttps://example.com\n');
  assert.deepEqual(p.meta, {});
  assert.equal(p.body, 'body\n--\nhttps://example.com');
});

test('the last "--" counts', () => {
  const p = parsePost('T\n\none\n--\ntwo\n\n--\nsessions: 1\n');
  assert.equal(p.body, 'one\n--\ntwo');
  assert.deepEqual(p.meta, { sessions: '1' });
});

test('unknown keys stay', () => {
  const file = 'T\n\nc\n\n--\nnote: keep\nsessions: 2\n';
  assert.equal(serializePost(parsePost(file)), file);
});

test('title and body for the text area', () => {
  assert.deepEqual(splitTitleBody('\n\nTitle\n\n\nbody\n\n'), { title: 'Title', body: 'body' });
  assert.equal(joinTitleBody('Title', 'body'), 'Title\n\nbody');
  assert.equal(joinTitleBody('Title', ''), 'Title');
});

test('an accented key or a key without a value is still part of the block', () => {
  const file = 'T\n\nc\n\n--\nnaïve: yes\nnote:\nsessions: 2\n';
  const p = parsePost(file);
  assert.equal(p.body, 'c');
  assert.deepEqual(p.meta, { 'naïve': 'yes', note: '', sessions: '2' });
  assert.equal(serializePost(p), file);
});

test('a broken block left in the body is recognised, so it is not published', () => {
  const stamp = 'started: 2026-10-03T21:14-05:00';
  const broken = [
    `T\n\nc\n\n--\n${stamp}\na line without form\n`,
    `T\n\nc\n\n--\n${stamp}\n--\n`,
    `T\n\nc\n\n---\n${stamp}\n`,
    `T\n\nc\n\n${stamp}\nsessions: 2\n`,
    `T\n\nc\n\n--\nStarted : 2026-10-03T21:14-05:00\na line without form\n`,
    `T\n\nc\n\n--\nfinished: 2026-10-05T08:02-05:00\na line without form\n`,
    `T\n\nc\n\n--\nwritten: 86 min\na line without form\n`,
    `T\n\nc\n\n--\nsessions: 3\na line without form\n`,
    `T\n\nc\n\n--\nstarted: 2026-10-03 21:14\na line without form\n`,
  ];
  for (const file of broken) {
    const p = parsePost(file);
    assert.deepEqual(p.meta, {}, file);
    assert.equal(hasBrokenBlock(p.body), true, file);
  }
});

test('a time in the editor\'s form stops publishing even inside a sentence', () => {
  assert.equal(hasBrokenBlock('The file ends with started: 2026-10-03T21:14-05:00 and that is all.'), true);
  assert.equal(hasBrokenBlock('> started: 2026-10-03T21:14-05:00'), true);
  assert.equal(hasBrokenBlock('"2026-10-03T21:14:05-05:00" with seconds'), false);
  assert.equal(hasBrokenBlock('new Date("2026-10-03T21:14:05Z")'), false);
  assert.equal(hasBrokenBlock('at 21:14 on 2026-10-03'), false);
});

test('a normal body is not mistaken for a broken block', () => {
  assert.equal(hasBrokenBlock(parsePost(FILE).body), false);
  assert.equal(hasBrokenBlock('signature\n--\nPS hello'), false);
  assert.equal(hasBrokenBlock('Finished: it works now.\nI have written: three lines.\nThe sessions: many.'), false);
  assert.equal(hasBrokenBlock('written: 86 minutes in a row, no breaks'), false);
  assert.equal(hasBrokenBlock(''), false);
});

test('the pills at the end of the body come off the text', () => {
  const body = 'The story.\n\nThe lesson.\n\npill: Why does it lie? | Because the copy is old.\npill: What fixes it? | A new version.';
  assert.deepEqual(splitPills(body), {
    body: 'The story.\n\nThe lesson.',
    pills: [{ question: 'Why does it lie?', answer: 'Because the copy is old.' }, { question: 'What fixes it?', answer: 'A new version.' }],
    bad: [],
  });
});

test('a pill: line in the middle of the text stays text', () => {
  const body = 'pill: this line opens the story | and it is not a pill\n\nThe story goes on.\n\npill: Q1? | A1.\npill: Q2? | A2.';
  const out = splitPills(body);
  assert.equal(out.body, 'pill: this line opens the story | and it is not a pill\n\nThe story goes on.');
  assert.equal(out.pills.length, 2);
  assert.deepEqual(splitPills('Just a story about a pill: nothing else.'), { body: 'Just a story about a pill: nothing else.', pills: [], bad: [] });
});

test('the answer can hold |; blank lines between pills, spaces, capitals and Windows line ends do not count', () => {
  const out = splitPills('Story.\r\n\r\npill: Which pipe? | a | b\r\n\r\nPILL:  Spaced?  |  Yes.  \r\n');
  assert.deepEqual(out.pills, [{ question: 'Which pipe?', answer: 'a | b' }, { question: 'Spaced?', answer: 'Yes.' }]);
  assert.equal(out.body, 'Story.');
  assert.deepEqual(out.bad, []);
});

test('a broken pill line, or fewer than two pills: a readable problem', () => {
  assert.deepEqual(splitPills('Story.\n\npill: no answer here\npill: | no question').bad, ['pill: no answer here', 'pill: | no question']);
  assert.match(pillProblem('Story.\n\npill: no answer here\npill: Q? | A.'), /pill line without a question or an answer: pill: no answer here/);
  assert.match(pillProblem('Story.\n\npill: Q? | A.'), /a learn needs at least two "pill: question \| answer" lines at the end of the text \(found 1\)/);
  assert.equal(pillProblem('Story.\n\npill: Q1? | A1.\npill: Q2? | A2.'), '');
});
