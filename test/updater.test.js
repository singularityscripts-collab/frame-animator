// Atualização automática: comparação de versões e os endereços aceitos para download.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../updater.cjs', import.meta.url), 'utf8');
const pick = (name) => src.slice(src.indexOf(`function ${name}(`), src.indexOf('\n}\n', src.indexOf(`function ${name}(`)) + 2);
const compareVersions = new Function(`${pick('compareVersions')}; return compareVersions;`)();
const safeUrl = new Function(`const ALLOWED_HOSTS = new Set(['api.github.com', 'github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']); ${pick('safeUrl')}; return safeUrl;`)();

test('versões: 0.2.0 é mais nova que 0.1.9 e 0.10.0 é mais nova que 0.9.0', () => {
  assert.ok(compareVersions('0.2.0', '0.1.9') > 0);
  assert.ok(compareVersions('v0.10.0', '0.9.0') > 0);
  assert.equal(compareVersions('1.0.0', 'v1.0.0'), 0);
  assert.ok(compareVersions('0.1.0', '0.2.0') < 0);
});

test('download só de endereços https do GitHub', () => {
  assert.ok(safeUrl('https://github.com/singularityscripts-collab/frame-animator/releases/download/v0.2.0/x.exe'));
  assert.throws(() => safeUrl('http://github.com/x'));
  assert.throws(() => safeUrl('https://exemplo.com/x.exe'));
  assert.throws(() => safeUrl('https://github.com.exemplo.com/x.exe'));
});
