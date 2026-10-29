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

const has = (block, parts) => {
  for (const part of parts) assert.ok(block.includes(part), part);
};

test('the root font size is 90%, so every rem is 14.4px', async () => {
  assert.ok(rule(await css(), 'html').includes('font-size: 90%;'));
});

test('no font size is set in pixels', async () => {
  assert.ok(!/font-size:\s*[\d.]+px/.test(await css()));
});

test('the body is Palatino at 1rem, the pieces are Inconsolata at 1.125rem in a wrapping block', async () => {
  const text = await css();
  const body = rule(text, 'body');
  has(body, ["font-family: Palatino, 'Palatino Linotype', 'Book Antiqua', Georgia, serif;", 'font-size: 1rem;', 'text-rendering: optimizeLegibility;']);
  has(rule(text, 'pre'), [
    'margin: 1.25rem 0 0 0.625rem;', 'font-family: Inconsolata, Courier, monospace;', 'font-size: 1.125rem;',
    'line-height: 1.3;', 'white-space: pre-wrap;', 'overflow-wrap: break-word;',
  ]);
  assert.ok(rule(text, '.write textarea').includes('font-family: Inconsolata, Courier, monospace;'));
});

test('the column is 800px wide from 1024px up, 90% below, with 15px of padding', async () => {
  const text = await css();
  assert.match(text, /@media screen and \(min-width: 1024px\) \{\n {2}header, main, footer, #demo-note \{ width: 800px; \}\n\}/);
  assert.ok(rule(text, 'header, main, footer, #demo-note').includes('width: 90%;'));
  assert.ok(rule(text, 'header').includes('padding: 15px 0 0 15px;'));
  assert.ok(rule(text, 'main').includes('padding: 15px;'));
});

test('the header: a fluid bold h1 inline, the nav inline with grey 0.875rem links 20px apart', async () => {
  const text = await css();
  has(rule(text, 'header h1'), ['display: inline;', 'font-size: clamp(1.875rem, 7.2vw, 3.125rem);', 'font-weight: 700;', 'line-height: 1.15;']);
  has(rule(text, 'header nav'), ['display: inline;', 'font-size: 0.875rem;']);
  assert.ok(rule(text, 'header nav a, header nav button').includes('margin-left: 20px;'));
});

test('the h1 scales with the viewport, with no separate phone size', async () => {
  const text = await css();
  assert.ok(!text.includes('max-width: 600px'));
  assert.ok(!/header h1 \{ font-size/.test(text));
});

test('the editor list and status line are monospace, so the 8-character section column lines up', async () => {
  assert.ok(rule(await css(), '.write #list, .bar #status').includes('font-family: Inconsolata, Courier, monospace;'));
});

test('the editor: textarea and list at 1.125rem, the list at line-height 1.7, the bar at 0.875rem', async () => {
  const text = await css();
  has(rule(text, '.write textarea, .write #list'), ['font-size: 1.125rem;', 'line-height: 1.3;']);
  assert.ok(rule(text, '.write #list').includes('line-height: 1.7;'));
  assert.ok(rule(text, '.bar').includes('font-size: 0.875rem;'));
});

test('articles: an inline fluid h2 and an inline grey 0.875rem address', async () => {
  const text = await css();
  has(rule(text, 'article h2'), ['display: inline;', 'font-size: clamp(1.5rem, 5.4vw, 1.875rem);', 'font-weight: 400;', 'line-height: 1.2;']);
  has(rule(text, 'article address'), ['display: inline;', 'font-size: 0.875rem;', 'color: var(--soft);']);
});

test('the list rows are 1.25rem at line-height 1.7, the date 0.875rem from the title', async () => {
  const text = await css();
  has(rule(text, '.list article h2'), ['font-size: 1.25rem;', 'line-height: 1.7;']);
  assert.ok(rule(text, '.list article address').includes('0.875rem'));
});

test('the footer is centred, grey, 0.875rem, with a rule on top', async () => {
  has(rule(await css(), 'footer'), ['text-align: center;', 'font-size: 0.875rem;', 'border-top: 1px solid var(--rule);', 'color: var(--foot);']);
});

test('the colours: white, black, #666 links, #999, #ccc, a #f4f3f1 panel; dark #111, #e6e6e6, #9a9a9a, #8a8a8a, #333, a #1c1c1c panel; no accent', async () => {
  const text = await css();
  assert.ok(text.includes(':root { --paper: #ffffff; --ink: #000000; --link: #666666; --soft: #999999; --rule: #cccccc; --foot: #cccccc;'));
  assert.ok(text.startsWith(':root {') && /^:root \{[^}]*--panel: #f4f3f1;/.test(text));
  const dark = '--paper: #111111; --ink: #e6e6e6; --link: #9a9a9a; --soft: #8a8a8a; --rule: #333333; --foot: #8a8a8a;';
  assert.ok(text.includes(`:root:not([data-theme="light"]) { ${dark}`));
  assert.ok(text.includes(`:root[data-theme="dark"] { ${dark}`));
  assert.match(text, /:root:not\(\[data-theme="light"\]\) \{[^}]*--panel: #1c1c1c;/);
  assert.match(text, /:root\[data-theme="dark"\] \{[^}]*--panel: #1c1c1c;/);
  assert.ok(!text.includes('--accent'));
  assert.ok(!/#[0-9a-f]{3,6}\b/i.test(text.slice(text.indexOf('@font-face'))), 'colours only through the tokens');
});

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);

test('in the dark theme dates, footer and links reach 4.5:1 on the paper and on the panel', async () => {
  const text = await css();
  const dark = text.slice(text.indexOf(':root[data-theme="dark"] {'));
  const token = (name) => new RegExp(`--${name}: (#[0-9a-f]{6});`).exec(dark)[1];
  for (const name of ['soft', 'foot', 'link', 'note']) {
    assert.ok(contrast(token(name), token('paper')) >= 4.5, `${name} ${contrast(token(name), token('paper')).toFixed(2)}`);
  }
  for (const name of ['soft', 'link', 'ink']) {
    assert.ok(contrast(token(name), token('panel')) >= 4.5, `${name} on panel ${contrast(token(name), token('panel')).toFixed(2)}`);
  }
});

test('secondary text on the panels uses --soft-on-panel, which reaches 4.5:1 on the panel in both themes', async () => {
  const text = await css();
  const light = text.slice(0, text.indexOf('}'));
  const dark = text.slice(text.indexOf(':root[data-theme="dark"] {'));
  for (const block of [light, dark]) {
    const token = (name) => new RegExp(`--${name}: (#[0-9a-f]{6});`).exec(block)[1];
    for (const name of ['soft-on-panel', 'link', 'ink']) {
      assert.ok(contrast(token(name), token('panel')) >= 4.5, `${name} on panel ${contrast(token(name), token('panel')).toFixed(2)}`);
    }
  }
  assert.match(text, /:root:not\(\[data-theme="light"\]\) \{[^}]*--soft-on-panel: #[0-9a-f]{6};/);
  assert.ok(rule(text, '.pill-title').includes('color: var(--soft-on-panel);'));
  for (const selector of ['.blog-box', '.blog-title', '.blog-icon', '.blog-rotation', '.blog-toggle', '.pill', '.pill-title', '.pill-q', '.pill-a', '.pill-from', '.pill-skip']) {
    assert.ok(!rule(text, selector).includes('var(--soft)'), selector);
  }
  assert.ok(rule(text, 'article address').includes('color: var(--soft);'));
  assert.ok(rule(text, '.blog-intro').includes('color: var(--soft);'));
});

test('the demo note: a box with a 1px rule, 0.875rem text, 1rem code, the close button on the right', async () => {
  const text = await css();
  has(rule(text, '#demo-note'), ['border: 1px solid var(--rule);', 'font-size: 0.875rem;']);
  assert.ok(rule(text, '#demo-note code').includes('font-size: 1rem;'));
  assert.ok(rule(text, '#demo-close').includes('margin-left: auto;'));
});

test('the learns box is a clickable panel, with the list 1.75rem below it', async () => {
  const text = await css();
  has(rule(text, '.blog-box'), ['position: relative;', 'margin: 0 0 0.75rem;', 'padding: 0.9rem 1.1rem;', 'background: var(--panel);', 'cursor: pointer;']);
  assert.ok(rule(text, '.blog-box + .list').includes('margin-top: 1.75rem;'));
});

test('the learns box title: a fluid bold block with room for the toggle, in ink, with a soft pencil', async () => {
  const text = await css();
  const title = rule(text, '.blog-title');
  has(title, ['margin: 0 2.5rem 0.5rem 0;', 'font-size: clamp(1.5rem, 4.5vw, 2.25rem);', 'font-weight: 700;', 'line-height: 1.15;']);
  assert.ok(!title.includes('display: inline;'));
  assert.ok(rule(text, '.blog-title a').includes('color: var(--ink);'));
  has(rule(text, '.blog-icon'), ['display: inline-block;', 'width: 0.6em;', 'height: 0.6em;', 'margin-left: 0.35em;', 'vertical-align: 0.05em;', 'fill: none;', 'stroke: var(--soft-on-panel);', 'stroke-width: 1.75;']);
});

test('the learns box rotation: one 1.125rem line with an ellipsis, two fixed lines on phones, links in ink', async () => {
  const text = await css();
  has(rule(text, '.blog-rotation'), ['list-style: none;', 'margin: 0;', 'padding: 0;', 'font-size: 1.125rem;', 'line-height: 1.4;']);
  has(rule(text, '.blog-rotation li'), ['white-space: nowrap;', 'overflow: hidden;', 'text-overflow: ellipsis;']);
  const phone = text.slice(text.indexOf('@media (max-width: 40rem) {'));
  assert.ok(text.includes('@media (max-width: 40rem) {'));
  has(phone.slice(0, phone.indexOf('}')), ['.blog-rotation li', 'white-space: normal;', 'display: -webkit-box;', '-webkit-box-orient: vertical;', '-webkit-line-clamp: 2;', 'overflow: hidden;', 'min-height: 2.8em;']);
  assert.ok(rule(text, '.blog-rotation a').includes('color: var(--ink);'));
});

test('the learns box toggle sits in the top right corner with a 2.5rem target', async () => {
  has(rule(await css(), '.blog-toggle'), [
    'position: absolute;', 'top: calc(0.9rem + 0.5625rem - 1.25rem);', 'right: calc(1.1rem + 0.28125rem - 1.25rem);',
    'display: inline-flex;', 'align-items: center;', 'justify-content: center;',
    'min-width: 2.5rem;', 'min-height: 2.5rem;', 'padding: 0;', 'font-size: 1.125rem;', 'line-height: 1;',
  ]);
});

test('the learns page: a fluid bold title and a soft 0.875rem intro', async () => {
  const text = await css();
  has(rule(text, '.blog-page-title'), ['margin: 0 0 0.75rem;', 'font-size: clamp(1.5rem, 4.5vw, 2.25rem);', 'font-weight: 700;', 'line-height: 1.15;']);
  has(rule(text, '.blog-intro'), ['margin: 0 0 0.75rem;', 'font-size: 0.875rem;', 'color: var(--soft);']);
});

test('the Learning Pill is a panel without a border, the question and answer at 1.125rem', async () => {
  const text = await css();
  const pill = rule(text, '.pill');
  has(pill, ['margin: 0 0 1.75rem;', 'padding: 0.9rem 1.1rem;', 'background: var(--panel);']);
  assert.ok(!pill.includes('border'));
  has(rule(text, '.pill-title'), ['margin: 0 0 0.5rem;', 'font-size: 0.875rem;', 'font-weight: 400;', 'color: var(--soft-on-panel);']);
  has(rule(text, '.pill-q'), ['margin: 0;', 'font-size: 1.125rem;', 'line-height: 1.4;']);
  has(rule(text, '.pill-a'), ['margin-top: 0.5rem;', 'font-size: 1.125rem;', 'line-height: 1.4;']);
  assert.ok(rule(text, '.pill-a p').includes('margin: 0 0 0.4rem;'));
  has(rule(text, '.pill-from'), ['font-size: 0.875rem;', 'color: var(--soft-on-panel);']);
  has(rule(text, '.pill-open'), ['display: inline-flex;', 'min-width: 2.5rem;', 'min-height: 2.5rem;', 'vertical-align: middle;']);
  has(rule(text, '.pill-arrow'), ['width: 0.9em;', 'height: 0.9em;', 'stroke: currentColor;', 'stroke-width: 2;']);
  assert.ok(rule(text, '.pill-open[aria-expanded="true"] .pill-arrow').includes('transform: rotate(90deg);'));
  has(rule(text, '.pill-skip'), ['margin: 0.5rem 0 0;', 'font-size: 0.875rem;']);
});
