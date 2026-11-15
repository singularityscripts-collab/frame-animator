// Janela de teste: só o player, sem nada do editor. É o embrião do export HTML5.
import { mountPlayer } from './player/player.js';
import { movieLength } from './player/render.js';

const info = document.getElementById('info');
const data = window.api ? await window.api.getPreviewData() : localStorage.getItem('fa-preview');

if (!data) {
  info.textContent = 'Nada para tocar.';
} else {
  const doc = JSON.parse(data);
  const player = mountPlayer(document.getElementById('player'), doc);
  player.play(0);
  const scenes = doc.scenes.length > 1 ? ` em ${doc.scenes.length} cenas` : '';
  info.textContent = `${movieLength(doc)} quadros${scenes} · ${doc.fps} fps · clique para pausar`;
  document.body.addEventListener('click', () => (player.playing ? player.stop() : player.play(player.lastFrame + 1)));
}
