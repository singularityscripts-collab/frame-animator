// Janela de teste: só o player, sem nada do editor. É o embrião do export HTML5.
import { mountPlayer } from './player/player.js';
import { sceneLength } from './player/render.js';

const info = document.getElementById('info');
const data = window.api ? await window.api.getPreviewData() : localStorage.getItem('fa-preview');

if (!data) {
  info.textContent = 'Nada para tocar.';
} else {
  const doc = JSON.parse(data);
  const player = mountPlayer(document.getElementById('player'), doc);
  player.play(0);
  info.textContent = `${sceneLength(doc.scenes[0])} quadros · ${doc.fps} fps · clique para pausar`;
  document.body.addEventListener('click', () => (player.playing ? player.stop() : player.play(player.lastFrame + 1)));
}
