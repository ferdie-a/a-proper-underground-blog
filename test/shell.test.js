import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

test('the offline copy of the editor holds every file of site/', async () => {
  const source = await readFile('site/sw.js', 'utf8');
  const shell = [...source.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const files = (await readdir('site', { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => '/' + `${entry.parentPath}/${entry.name}`.replace(/\\/g, '/').replace(/^site[/]/, ''))
    .filter((path) => path !== '/sw.js' && path !== '/fonts/OFL.txt');
  const generated = ['/write', '/manifest.json'];
  assert.deepEqual([...shell].sort(), [...files, ...generated].sort());
});
