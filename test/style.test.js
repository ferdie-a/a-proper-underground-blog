import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = () => readFile('site/style.css', 'utf8');

function withoutHoverBlocks(text) {
  let out = '';
  let i = 0;
  for (;;) {
    const start = text.indexOf('@media (hover: hover)', i);
    if (start === -1) return out + text.slice(i);
    out += text.slice(i, start);
    let depth = 0;
    let j = text.indexOf('{', start);
    for (; j >= 0 && j < text.length; j++) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}' && --depth === 0) break;
    }
    i = j < 0 ? text.length : j + 1;
  }
}

test('every :hover rule applies only with a real pointer, inside @media (hover: hover)', async () => {
  const text = await css();
  assert.match(text, /@media \(hover: hover\) \{/);
  assert.ok(!withoutHoverBlocks(text).includes(':hover'));
});

test('the stylesheet has no rules for parts the pages do not have', async () => {
  const text = await css();
  assert.ok(!text.includes('.blog-foot'));
  assert.ok(!/footer/i.test(text));
});

test('the stylesheet keeps the learns box and the Learning Pill rules', async () => {
  const text = await css();
  for (const kept of ['.blog-box {', '.blog-title {', '.blog-icon {', '.blog-rotation {', '.blog-toggle {', '.blog-page-title {', '.blog-intro {', '.pill {', '.pill-open {', '.pill-skip {']) {
    assert.ok(text.includes(kept), kept);
  }
});
