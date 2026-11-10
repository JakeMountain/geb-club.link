// Every script the site serves must at least parse: the .js files in public/ and the
// inline <script> blocks in its pages. A page with a syntax error just shows "Loading…".
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

// Inline scripts keep their line numbers, so an error points at the right line of the page.
const scriptsIn = (file) => {
  const src = readFileSync(file, 'utf8');
  if (file.endsWith('.js')) return [src];
  return [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => '\n'.repeat(src.slice(0, m.index).split('\n').length - 1) + m[1]);
};

test('every script in public/ parses', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'geb-pages-'));
  try {
    const errors = [];
    for (const file of walk('public').filter((f) => /\.(html|js)$/.test(f))) {
      for (const code of scriptsIn(file)) {
        const t = join(tmp, 'check.mjs');
        writeFileSync(t, code);
        try { execFileSync(process.execPath, ['--check', t], { stdio: 'pipe' }); }
        catch (e) { errors.push(`${file}: ${String(e.stderr).split('\n').slice(0, 5).join('\n')}`); }
      }
    }
    assert.deepEqual(errors, []);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
