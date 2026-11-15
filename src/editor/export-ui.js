// Exportar animação: MP4, MOV, GIF animado e sequência PNG.
// O player desenha cada quadro aqui; o processo principal grava os PNGs ou passa os quadros para o ffmpeg.

import { openDialog, openProgress } from './ui-kit.js';
import { renderDocumentFrame, sceneLength, movieLength, movieLocate } from '../player/render.js';
import { movieSchedule, mixdownWav } from '../player/audio.js';
import { clone } from '../model/document.js';

export const FORMATS = {
  mp4: { label: 'Vídeo MP4 (H.264)', alpha: false, even: true },
  mov: { label: 'Vídeo MOV (ProRes)', alpha: true, even: true },
  gif: { label: 'GIF animado', alpha: true, even: false },
  png: { label: 'Sequência PNG', alpha: true, even: false },
};

export function exportSize(doc, scalePct, format) {
  const s = Math.max(1, Math.min(400, scalePct)) / 100;
  let w = Math.max(1, Math.round(doc.width * s));
  let h = Math.max(1, Math.round(doc.height * s));
  if (FORMATS[format].even) {
    w += w % 2;
    h += h % 2;
  }
  return { w, h };
}

/** Abre o diálogo de exportação e, se confirmado, exporta. */
export async function exportDialog(editor) {
  const api = window.api;
  if (!api?.exportBegin) {
    editor.toast('Exportar vídeo e GIF funciona no aplicativo (npm start), não no navegador.');
    return;
  }
  editor.stop();
  const doc = editor.doc;
  const sceneLen = sceneLength(doc.scenes[editor.sceneIndex]);
  const many = doc.scenes.length > 1;
  const len = sceneLen;
  const opts = await openDialog({
    title: 'Exportar animação',
    ok: 'Exportar…',
    body: `
      <label class="dlg-row"><span>Formato</span>
        <select name="format">${Object.entries(FORMATS)
          .map(([k, f]) => `<option value="${k}">${f.label}</option>`)
          .join('')}</select></label>
      ${many ? `<label class="dlg-row"><span>Cenas</span><select name="scenes"><option value="current">Só a cena atual (${doc.scenes[editor.sceneIndex].name.replace(/</g, '&lt;')})</option><option value="all">Todas, em sequência (${movieLength(doc)} quadros)</option></select></label>` : ''}
      <label class="dlg-row"><span>Tamanho (%)</span>
        <div class="dlg-row inline"><input type="number" name="scale" value="100" min="10" max="400" step="5" style="width:80px"><span class="dlg-text" data-size></span></div></label>
      <div class="dlg-row"><span>Quadros</span>
        <div class="dlg-row inline"><input type="number" name="from" value="1" min="1" max="${len}" style="width:70px"><span class="dlg-text">até</span><input type="number" name="to" value="${len}" min="1" max="${len}" style="width:70px"></div></div>
      <label class="dlg-row"><span>Fundo</span>
        <span><input type="checkbox" name="transparent"> <span class="dlg-text" data-alpha>Transparente</span></span></label>
      <label class="dlg-row" data-gif><span>Repetir GIF</span>
        <select name="gifLoop"><option value="0">Sempre</option><option value="-1">Tocar uma vez</option></select></label>
      <p class="dlg-text">${doc.fps} fps · ${len} ${len === 1 ? 'quadro' : 'quadros'} na cena. Movie clips tocam no export${doc.library.sounds.length ? '; o som vai junto em MP4 e MOV' : ''}.</p>`,
    onOpen(form) {
      const update = () => {
        const f = form.format.value;
        const { w, h } = exportSize(doc, parseFloat(form.scale.value) || 100, f);
        form.querySelector('[data-size]').textContent = `${w} × ${h} px`;
        form.transparent.disabled = !FORMATS[f].alpha;
        if (!FORMATS[f].alpha) form.transparent.checked = false;
        form.querySelector('[data-alpha]').textContent = FORMATS[f].alpha ? 'Transparente' : 'Transparente (não disponível em MP4)';
        form.querySelector('[data-gif]').hidden = f !== 'gif';
        if (form.scenes) {
          const total = form.scenes.value === 'all' ? movieLength(doc) : sceneLen;
          form.to.max = form.from.max = total;
          if (Number(form.to.value) > total || form.scenes.dataset.last !== form.scenes.value) form.to.value = total;
          form.scenes.dataset.last = form.scenes.value;
        }
      };
      form.addEventListener('input', update);
      update();
    },
  });
  if (!opts) return;
  const all = opts.scenes === 'all';
  const total = all ? movieLength(doc) : sceneLen;
  const from = Math.max(1, Math.min(total, parseInt(opts.from, 10) || 1)) - 1;
  const to = Math.max(from + 1, Math.min(total, parseInt(opts.to, 10) || total)) - 1;
  await runExport(editor, {
    allScenes: all,
    format: opts.format,
    scale: parseFloat(opts.scale) || 100,
    from,
    to,
    transparent: !!opts.transparent && FORMATS[opts.format].alpha,
    gifLoop: parseInt(opts.gifLoop, 10) || 0,
  });
}

/** Exporta sem perguntar nada (também usado pelo teste automático). opts.path pula o diálogo de salvar. */
export async function runExport(editor, { format, scale = 100, from = 0, to, transparent = false, gifLoop = 0, path, quiet = false, allScenes = false }) {
  const api = window.api;
  const doc = clone(editor.doc); // o documento não muda durante o export
  const scene = editor.sceneIndex;
  to ??= (allScenes ? movieLength(doc) : sceneLength(doc.scenes[scene])) - 1;
  // quadro do export → { cena, quadro }
  const locate = (f) => (allScenes ? movieLocate(doc, f) : { sceneIndex: scene, frame: f });
  const { w, h } = exportSize(doc, scale, format);
  // som: mixa a agenda dos quadros exportados (só vídeo leva áudio)
  let audio = null;
  if ((format === 'mp4' || format === 'mov') && doc.library.sounds.length) {
    const segs = [];
    for (let f = from; f <= to; f++) {
      const l = locate(f);
      const last = segs[segs.length - 1];
      if (last && last.sceneIndex === l.sceneIndex && last.to === l.frame - 1) last.to = l.frame;
      else segs.push({ sceneIndex: l.sceneIndex, from: l.frame, to: l.frame });
    }
    try {
      audio = await mixdownWav(doc, movieSchedule(doc, segs), (to - from + 1) / doc.fps);
    } catch (err) {
      console.warn('Som não mixado', err);
      editor.toast('O som não pôde ser mixado; o vídeo sai sem áudio.');
    }
  }
  const job = await api.exportBegin({
    audio,
    format,
    width: w,
    height: h,
    fps: doc.fps,
    transparent,
    gifLoop,
    path,
    defaultName: editor.fileName,
  });
  if (!job) return null;

  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d', { willReadFrequently: format !== 'png' });
  const total = to - from + 1;
  const progress = quiet ? null : openProgress(`Exportando ${FORMATS[format].label}`);
  try {
    for (let f = from; f <= to; f++) {
      if (progress?.cancelled) {
        await api.exportCancel(job.id);
        editor.toast('Exportação cancelada.');
        return null;
      }
      const loc = locate(f);
      renderDocumentFrame(ctx, doc, loc.sceneIndex, loc.frame, { width: w, height: h, transparent });
      let data;
      if (format === 'png') {
        const blob = canvas.convertToBlob ? await canvas.convertToBlob({ type: 'image/png' }) : await new Promise((r) => canvas.toBlob(r, 'image/png'));
        data = await blob.arrayBuffer();
      } else {
        data = ctx.getImageData(0, 0, w, h).data.buffer;
      }
      await api.exportFrame(job.id, data);
      progress?.update((f - from + 1) / total, `Quadro ${f - from + 1} de ${total}`);
    }
    progress?.update(1, format === 'png' ? 'Terminando…' : 'Codificando com o ffmpeg…');
    const res = await api.exportEnd(job.id);
    progress?.close();
    if (!quiet) {
      editor.toast(`Exportado: ${res.path.split(/[\\/]/).pop()}`);
    }
    return res;
  } catch (err) {
    progress?.close();
    await api.exportCancel(job.id).catch(() => {});
    const msg = String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    editor.toast(`Falha ao exportar: ${msg}`);
    if (quiet) throw err;
    return null;
  }
}
