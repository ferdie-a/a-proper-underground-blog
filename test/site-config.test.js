import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSiteConfig } from '../build.js';

const FULL = { name: 'A test blog', lang: 'en', learns: { title: 'Notes', intro: 'Things I found out.' } };

async function dirWith(text) {
  const dir = await mkdtemp(join(tmpdir(), 'blog-config-'));
  if (text !== undefined) await writeFile(join(dir, 'site.json'), text);
  return dir;
}

test('readSiteConfig returns name, lang and the learns title and intro', async () => {
  const dir = await dirWith(JSON.stringify(FULL));
  assert.deepEqual(await readSiteConfig(dir), FULL);
});

test('the repo site.json has the published defaults', async () => {
  assert.deepEqual(await readSiteConfig('.'), {
    name: 'a proper underground blog',
    shortName: 'underground',
    lang: 'en',
    learns: { title: 'Learns', intro: 'Short notes on things I just learned.' },
  });
});

test('a missing field stops with an error that names the field', async () => {
  const cases = {
    name: { lang: 'en', learns: FULL.learns },
    lang: { name: 'A test blog', learns: FULL.learns },
    'learns.title': { name: 'A test blog', lang: 'en', learns: { intro: 'Things I found out.' } },
    'learns.intro': { name: 'A test blog', lang: 'en', learns: { title: 'Notes' } },
  };
  for (const [field, config] of Object.entries(cases)) {
    const dir = await dirWith(JSON.stringify(config));
    await assert.rejects(readSiteConfig(dir), { message: `site.json: missing "${field}"` }, field);
  }
});

test('a missing learns object stops on learns.title', async () => {
  const dir = await dirWith(JSON.stringify({ name: 'A test blog', lang: 'en' }));
  await assert.rejects(readSiteConfig(dir), { message: 'site.json: missing "learns.title"' });
});

test('an empty or non-string field counts as missing', async () => {
  for (const name of ['', '   ', 42, null, ['x']]) {
    const dir = await dirWith(JSON.stringify({ ...FULL, name }));
    await assert.rejects(readSiteConfig(dir), { message: 'site.json: missing "name"' }, JSON.stringify(name));
  }
});

test('shortName is optional and, when present, comes back as written', async () => {
  const dir = await dirWith(JSON.stringify({ ...FULL, shortName: 'Notes' }));
  assert.deepEqual(await readSiteConfig(dir), { ...FULL, shortName: 'Notes' });
});

test('a shortName that is empty or not a string stops with an error that names it', async () => {
  for (const shortName of ['', '  ', 7, null]) {
    const dir = await dirWith(JSON.stringify({ ...FULL, shortName }));
    await assert.rejects(readSiteConfig(dir), { message: 'site.json: "shortName" must be a non-empty string when present' }, JSON.stringify(shortName));
  }
});

test('without site.json the error names the file and the folder', async () => {
  const dir = await dirWith();
  await assert.rejects(readSiteConfig(dir), { message: `site.json: not found in ${dir}` });
});

test('a site.json that is not valid JSON stops with an error that names the file', async () => {
  const dir = await dirWith('{ "name": "A test blog", ');
  await assert.rejects(readSiteConfig(dir), /^Error: site\.json: not valid JSON/);
});

test('a site.json saved with a byte order mark still reads', async () => {
  const dir = await dirWith(String.fromCharCode(0xfeff) + JSON.stringify(FULL));
  assert.deepEqual(await readSiteConfig(dir), FULL);
});

test('a site.json that is not an object stops with an error that names the file', async () => {
  for (const text of ['[]', '"blog"', 'null']) {
    const dir = await dirWith(text);
    await assert.rejects(readSiteConfig(dir), /^Error: site\.json: /, text);
  }
});
