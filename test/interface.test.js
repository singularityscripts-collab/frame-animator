// Etapa 4 do REFINO (interface e atalhos): toda ação tem nome em português, para aparecer
// direito nos menus, na folha de atalhos (?) e nas mensagens de erro.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('toda ação tem nome legível (menus, folha de atalhos e mensagens de erro)', async () => {
  const src = ['actions.js', 'actions-final.js'].map((f) => fs.readFileSync(new URL(`../src/editor/${f}`, import.meta.url), 'utf8')).join('\n');
  const ids = new Set([...src.matchAll(/^\s{4}([a-zA-Z0-9]+): \{ keys:/gm)].map((m) => m[1]));
  for (const m of src.matchAll(/add\('([a-zA-Z0-9]+)'/g)) ids.add(m[1]);
  for (const skip of ['current', 'conflict', 'escape', 'toolSelect', 'toolRect', 'toolOval', 'toolLine', 'toolPencil', 'toolCamera', 'toolBrush', 'toolBucket', 'toolEraser', 'toolEyedropper', 'toolGradient', 'toolHand', 'toolZoom']) ids.delete(skip);
  globalThis.localStorage ??= { getItem: () => null, setItem() {} };
  const { ACTION_LABELS } = await import('../src/editor/actions-final.js').catch(() => ({ ACTION_LABELS: null }));
  const labels = ACTION_LABELS || Object.fromEntries([...src.matchAll(/([a-zA-Z0-9]+): '([^']+)'/g)].map((m) => [m[1], m[2]]));
  const missing = [...ids].filter((id) => !labels[id]);
  assert.deepEqual(missing, [], `ações sem nome: ${missing.join(', ')}`);
});
