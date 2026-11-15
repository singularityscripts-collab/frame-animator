// Ícones próprios, desenhados em SVG simples.
const svg = (body, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${body}</svg>`;

export const icons = {
  select: svg('<path d="M6 3.5 18 13l-5.6.9 3.3 6.3-2.4 1.2-3.3-6.3L6 19z" fill="currentColor" stroke-width="1.2"/>'),
  rect: svg('<rect x="4" y="6" width="16" height="12" rx="1"/>'),
  oval: svg('<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>'),
  line: svg('<path d="M5 19 19 5"/><circle cx="5" cy="19" r="1.4" fill="currentColor"/><circle cx="19" cy="5" r="1.4" fill="currentColor"/>'),
  pencil: svg('<path d="M4 20l1.2-4.6L15.6 5a2 2 0 0 1 2.8 0l.6.6a2 2 0 0 1 0 2.8L8.6 18.8z"/><path d="M13.8 6.8l3.4 3.4"/>'),
  hand: svg('<path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11m0-5.5V5a1.5 1.5 0 0 1 3 0v6m0-4.5a1.5 1.5 0 0 1 3 0V13c0 4-2.5 7-6.5 7-2.8 0-4.2-1.4-5.6-3.6L4.4 14a1.4 1.4 0 0 1 2.3-1.6L8 14"/>'),
  zoom: svg('<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5M8 10.5h5M10.5 8v5"/>'),
  swap: svg('<path d="M7 4 4 7l3 3"/><path d="M4 7h11a4 4 0 0 1 4 4v1"/><path d="M17 20l3-3-3-3"/><path d="M20 17H9a4 4 0 0 1-4-4v-1"/>'),
  reset: svg('<rect x="4" y="4" width="9" height="9" fill="currentColor" stroke="none"/><rect x="11" y="11" width="9" height="9"/>'),
  noColor: svg('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M5 19 19 5"/>'),

  play: svg('<path d="M7 5v14l12-7z" fill="currentColor"/>'),
  stop: svg('<rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor"/>'),
  prev: svg('<path d="M17 6v12L9 12z" fill="currentColor"/><path d="M7 6v12"/>'),
  next: svg('<path d="M7 6v12l8-6z" fill="currentColor"/><path d="M17 6v12"/>'),
  first: svg('<path d="M5 5v14"/><path d="M19 6v12l-9-6z" fill="currentColor"/>'),
  last: svg('<path d="M19 5v14"/><path d="M5 6v12l9-6z" fill="currentColor"/>'),
  loop: svg('<path d="M17 3l3 3-3 3"/><path d="M4 12V10a4 4 0 0 1 4-4h12"/><path d="M7 21l-3-3 3-3"/><path d="M20 12v2a4 4 0 0 1-4 4H4"/>'),
  onion: svg('<rect x="3" y="7" width="11" height="11" rx="1.5" opacity=".45"/><rect x="7" y="4" width="11" height="11" rx="1.5" opacity=".7"/><rect x="10" y="9" width="11" height="11" rx="1.5" fill="currentColor" fill-opacity=".25"/>'),
  test: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9v6l5-3z" fill="currentColor"/>'),

  eye: svg('<path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: svg('<path d="M3 3l18 18"/><path d="M10.6 6.1A10 10 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3 3.6M6.6 6.6C3.7 8.4 2 12 2 12s3.5 6.5 10 6.5a9.6 9.6 0 0 0 4.4-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  unlock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.6-1.7"/>'),
  layer: svg('<path d="M12 3 2 8l10 5 10-5z"/><path d="M2 13l10 5 10-5" opacity=".6"/>'),
  pencilSmall: svg('<path d="M4 20l1.2-4.6L15.6 5a2 2 0 0 1 2.8 0l.6.6a2 2 0 0 1 0 2.8L8.6 18.8z"/>'),
  addLayer: svg('<path d="M12 3 2 8l10 5 10-5z"/><path d="M2 13l6 3"/><path d="M18 14v7M14.5 17.5h7"/>'),
  trash: svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  outline: svg('<rect x="5" y="5" width="14" height="14" rx="2"/>'),
};
