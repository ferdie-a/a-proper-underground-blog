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
  assert.ok(!text.includes('.date'));
});

const rule = (text, selector) => {
  const at = text.indexOf('\n' + selector + ' {');
  assert.ok(at >= 0, selector);
  return text.slice(at, text.indexOf('}', at));
};

test('the body is Palatino at 16px, the pieces are Inconsolata at 16px in a wrapping block moved 20px right', async () => {
  const text = await css();
  const body = rule(text, 'body');
  assert.ok(body.includes("font-family: Palatino, 'Palatino Linotype', 'Book Antiqua', Georgia, serif;"));
  assert.ok(body.includes('font-size: 16px;') && body.includes('text-rendering: optimizeLegibility;'));
  const pre = rule(text, 'pre');
  assert.ok(pre.includes('font-family: Inconsolata, Courier, monospace;') && pre.includes('font-size: 16px;'));
  assert.ok(pre.includes('white-space: pre-wrap;') && pre.includes('word-wrap: break-word;'));
  assert.ok(/margin: \S+ \S+ \S+ 20px;/.test(pre));
  assert.ok(rule(text, '.write textarea').includes('font-family: Inconsolata, Courier, monospace;'));
});

test('the column is 800px wide from 1024px up, 90% below, with 15px of padding', async () => {
  const text = await css();
  assert.match(text, /@media screen and \(min-width: 1024px\) \{\n {2}header, main, footer, #demo-note \{ width: 800px; \}\n\}/);
  assert.ok(rule(text, 'header, main, footer, #demo-note').includes('width: 90%;'));
  assert.ok(rule(text, 'header').includes('padding: 15px 0 0 15px;'));
  assert.ok(rule(text, 'main').includes('padding: 15px;'));
});

test('the header: a 50px bold h1 inline, the nav inline with grey 14px links 20px apart', async () => {
  const text = await css();
  const h1 = rule(text, 'header h1');
  assert.ok(h1.includes('display: inline;') && h1.includes('font-size: 50px;') && h1.includes('font-weight: bold;'));
  const nav = rule(text, 'header nav');
  assert.ok(nav.includes('display: inline;') && nav.includes('font-size: 14px;'));
  assert.ok(rule(text, 'header nav a, header nav button').includes('margin-left: 20px;'));
});

test('on phones the h1 drops to 32px', async () => {
  assert.match(await css(), /@media screen and \(max-width: 600px\) \{\n {2}header h1 \{ font-size: 32px; \}\n\}/);
});

test('the editor list and status line are monospace, so the 8-character section column lines up', async () => {
  assert.ok(rule(await css(), '.write #list, .bar #status').includes('font-family: Inconsolata, Courier, monospace;'));
});

test('articles: inline 30px h2 and an inline grey 14px address', async () => {
  const text = await css();
  const h2 = rule(text, 'article h2');
  assert.ok(h2.includes('display: inline;') && h2.includes('font-size: 30px;'));
  const address = rule(text, 'article address');
  assert.ok(address.includes('display: inline;') && address.includes('font-size: 14px;') && address.includes('color: var(--soft);'));
});

test('the footer is centred, grey, 14px, with a rule on top', async () => {
  const footer = rule(await css(), 'footer');
  for (const part of ['text-align: center;', 'font-size: 14px;', 'border-top: 1px solid var(--rule);', 'color: var(--foot);']) {
    assert.ok(footer.includes(part), part);
  }
});

test('the colours: white, black, #666 links, #999, #ccc; dark #111, #e6e6e6, #9a9a9a, #8a8a8a, #333; no accent', async () => {
  const text = await css();
  assert.ok(text.includes(':root { --paper: #ffffff; --ink: #000000; --link: #666666; --soft: #999999; --rule: #cccccc; --foot: #cccccc;'));
  const dark = '--paper: #111111; --ink: #e6e6e6; --link: #9a9a9a; --soft: #8a8a8a; --rule: #333333; --foot: #8a8a8a;';
  assert.ok(text.includes(`:root:not([data-theme="light"]) { ${dark}`));
  assert.ok(text.includes(`:root[data-theme="dark"] { ${dark}`));
  assert.ok(!text.includes('--accent') && !text.includes('--panel'));
  assert.ok(!/#[0-9a-f]{3,6}\b/i.test(text.slice(text.indexOf('@font-face'))), 'colours only through the tokens');
});

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);

test('in the dark theme dates, footer and links reach 4.5:1 on the paper', async () => {
  const text = await css();
  const dark = text.slice(text.indexOf(':root[data-theme="dark"] {'));
  const token = (name) => new RegExp(`--${name}: (#[0-9a-f]{6});`).exec(dark)[1];
  for (const name of ['soft', 'foot', 'link', 'note']) {
    assert.ok(contrast(token(name), token('paper')) >= 4.5, `${name} ${contrast(token(name), token('paper')).toFixed(2)}`);
  }
});

test('the demo note: a box with a 1px rule, 14px text, the close button on the right', async () => {
  const text = await css();
  const note = rule(text, '#demo-note');
  assert.ok(note.includes('border: 1px solid var(--rule);') && note.includes('font-size: 14px;'));
  assert.ok(rule(text, '#demo-close').includes('margin-left: auto;'));
});

test('the stylesheet keeps the learns box and the Learning Pill rules', async () => {
  const text = await css();
  for (const kept of ['.blog-box {', '.blog-title {', '.blog-icon {', '.blog-rotation {', '.blog-toggle {', '.blog-page-title {', '.blog-intro {', '.pill {', '.pill-open {', '.pill-skip {']) {
    assert.ok(text.includes(kept), kept);
  }
});
