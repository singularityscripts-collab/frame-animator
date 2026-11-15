// Janela de teste: o runtime interativo (scripts, botões, componentes, som), sem nada do editor.
// É o mesmo runtime que vai no export HTML5.
import { Runtime } from './player/runtime.js';
import { movieLength } from './player/render.js';

const info = document.getElementById('info');
const log = document.getElementById('log');
const data = window.api ? await window.api.getPreviewData() : localStorage.getItem('fa-preview');

if (!data) {
  info.textContent = 'Nada para tocar.';
} else {
  const doc = JSON.parse(data);
  const rt = new Runtime(doc, document.getElementById('player'), {
    onTrace: (...a) => {
      console.log('[trace]', ...a);
      log.textContent = a.map(String).join(' ');
    },
  });
  rt.start();
  window.__rt = rt;
  const scenes = doc.scenes.length > 1 ? ` em ${doc.scenes.length} cenas` : '';
  info.textContent = `${movieLength(doc)} quadros${scenes} · ${doc.fps} fps`;
  const btn = document.getElementById('pause');
  btn.addEventListener('click', () => {
    rt.playing = !rt.playing;
    btn.textContent = rt.playing ? 'Pausar' : 'Continuar';
  });
}
