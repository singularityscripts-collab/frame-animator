// Empacota o player (src/player/*.js, módulos ES) num único script clássico para o export HTML5.
// Os módulos do player não têm nomes de topo repetidos entre si (o teste confere), então dá para
// juntar tudo num escopo só: tira import/export e mantém a ordem das dependências.

const fs = require('node:fs');
const path = require('node:path');

const IMPORT_RE = /^import\s+[\s\S]*?\s+from\s+['"](\.\/[^'"]+)['"];?[ \t]*$/gm;

function readModules(dir, entry) {
  const order = [];
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const m of src.matchAll(IMPORT_RE)) visit(path.posix.normalize(m[1]).replace(/^\.\//, ''));
    order.push({ file, src });
  };
  visit(entry);
  return order;
}

/** Nomes declarados no topo de um módulo. */
function topNames(src) {
  const out = [];
  for (const m of src.matchAll(/^(?:export\s+)?(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) out.push(m[1]);
  return out;
}

function stripModule(src) {
  return src
    .replace(IMPORT_RE, '')
    .replace(/^export\s*\{[^}]*\};?[ \t]*$/gm, '')
    .replace(/^export\s+default\s+/gm, '')
    .replace(/^export\s+(?=(?:async\s+)?function|const|let|var|class)/gm, '');
}

/**
 * Gera o script. `expose` lista os nomes que ficam em window.FrameAnimator.
 * Lança erro se dois módulos declararem o mesmo nome de topo.
 */
function bundlePlayer(dir, { entry = 'runtime.js', expose = ['Runtime', 'movieLength'] } = {}) {
  const mods = readModules(dir, entry);
  const owner = new Map();
  for (const m of mods) {
    for (const n of topNames(m.src)) {
      if (owner.has(n) && owner.get(n) !== m.file) throw new Error(`Nome repetido no player: ${n} (${owner.get(n)} e ${m.file})`);
      owner.set(n, m.file);
    }
  }
  const body = mods.map((m) => `// ---- ${m.file} ----\n${stripModule(m.src)}`).join('\n');
  return `/* Frame Animator player — gerado automaticamente. */
(function () {
'use strict';
${body}
window.FrameAnimator = { ${expose.join(', ')} };
})();
`;
}

const BOOT = `// Inicia o filme quando a página carrega.
(function () {
  var data = window.FA_MOVIE;
  var opts = window.FA_OPTIONS || {};
  var canvas = document.getElementById('fa-stage');
  if (!data || !canvas) return;
  var rt = new window.FrameAnimator.Runtime(data, canvas, { loop: opts.loop !== false, fit: opts.scale || 'fit' });
  rt.start();
  window.faRuntime = rt;
})();
`;

/** Arquivos do pacote HTML5: index.html, player.js, movie.js e boot.js. */
function html5Files(dir, doc, { title = 'Animação', loop = true, scale = 'fit' } = {}) {
  const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
  const fixed = scale === 'none';
  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:">
<title>${esc(title)}</title>
<style>
  html, body { margin: 0; height: 100%; background: ${esc(doc.background || '#ffffff')}; overflow: hidden; }
  #fa-wrap { position: relative; width: ${fixed ? `${doc.width}px` : '100%'}; height: ${fixed ? `${doc.height}px` : '100%'}; margin: 0 auto; }
  #fa-stage { display: block; width: 100%; height: 100%; touch-action: none; }
</style>
</head>
<body>
<div id="fa-wrap"><canvas id="fa-stage" tabindex="0"></canvas></div>
<script src="player.js"></script>
<script src="movie.js"></script>
<script src="boot.js"></script>
</body>
</html>
`;
  return {
    'index.html': html,
    'player.js': bundlePlayer(dir),
    'movie.js': `window.FA_MOVIE = ${JSON.stringify(doc)};\nwindow.FA_OPTIONS = ${JSON.stringify({ loop, scale: fixed ? 'none' : scale })};\n`,
    'boot.js': BOOT,
  };
}

module.exports = { bundlePlayer, html5Files, topNames, readModules };
