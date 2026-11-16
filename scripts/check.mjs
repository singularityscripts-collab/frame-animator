// Confere a sintaxe de todos os arquivos JavaScript do projeto (npm run check).
// Também confere se o player ainda vira um script só (o pacote HTML5 depende disso).
import { readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const skip = new Set(['node_modules', 'dist', 'out', '.git']);
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|mjs|cjs)$/.test(name)) files.push(p);
  }
};
walk(root);

let bad = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) {
    bad++;
    console.error(`✖ ${relative(root, f)}\n${r.stderr.trim()}\n`);
  }
}
try {
  createRequire(import.meta.url)('../bundler.cjs').bundlePlayer(join(root, 'src', 'player'));
} catch (err) {
  bad++;
  console.error(`✖ player para HTML5: ${err.message}`);
}
console.log(bad ? `${bad} problema(s) em ${files.length} arquivos.` : `ok: ${files.length} arquivos sem erro de sintaxe e player do HTML5 íntegro.`);
process.exit(bad ? 1 : 0);
