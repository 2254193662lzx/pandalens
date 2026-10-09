/* =============================================================================
 * icons.js — a small hand-built stroke icon set (24×24, 1.8px stroke).
 * ========================================================================== */
(function (global) {
  'use strict';

  const P = {
    /* navigation */
    database: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>',
    table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18M9 9v11"/>',
    sigma: '<path d="M17 5H7l6 7-6 7h10"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    flow: '<rect x="3" y="4" width="6" height="5" rx="1"/><rect x="15" y="4" width="6" height="5" rx="1"/><rect x="9" y="15" width="6" height="5" rx="1"/><path d="M6 9v3h12V9M12 12v3"/>',
    code: '<path d="M9 7l-5 5 5 5M15 7l5 5-5 5"/>',

    /* chart glyphs */
    hist: '<path d="M3 20h18"/><path d="M6 20v-6M10 20V7M14 20v-9M18 20V4"/>',
    bar: '<path d="M4 6h11M4 12h16M4 18h8"/>',
    line: '<path d="M3 17l5-6 4 3 5-8 4 3"/>',
    scatter: '<path d="M4 4v16h16"/><circle cx="9" cy="14" r="1.6"/><circle cx="13" cy="9" r="1.6"/><circle cx="17" cy="12" r="1.6"/><circle cx="8" cy="8" r="1.6"/>',
    box: '<path d="M4 8h4M4 16h4M16 8h4M16 16h4"/><rect x="8" y="6" width="8" height="12" rx="1"/><path d="M8 12h8"/>',
    pie: '<circle cx="12" cy="12" r="8"/><path d="M12 4v8h8"/>',
    corr: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
    heatmap: '<rect x="3" y="3" width="18" height="18" rx="2"/><rect x="3" y="3" width="6" height="6"/><rect x="9" y="9" width="6" height="6"/><rect x="15" y="3" width="6" height="6"/><rect x="3" y="15" width="6" height="6"/>',
    missing: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 7h.01M12 7h.01M17 10h.01M7 14h.01M12 17h.01M17 17h.01"/>',
    splom: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    parallel: '<path d="M5 3v18M12 3v18M19 3v18"/><path d="M5 8l7 7 7-4M5 15l7-4 7 6"/>',
    treemap: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 12h10M13 3v18M13 8h8"/>',
    radar: '<path d="M12 4l8 6-3 10H7L4 10z"/><path d="M12 8l4 3-1.5 5h-5L8 11z"/>',

    /* operation glyphs */
    filter: '<path d="M3 5h18l-7 8.5V20l-4-2.2v-4.3z"/>',
    sort: '<path d="M4 7h11M4 12h7M4 17h4"/><path d="M17 6v12M20 15l-3 3-3-3"/>',
    limit: '<path d="M4 6h16M4 12h11M4 18h6M18 14l3 3-3 3"/>',
    clean: '<path d="M6 20l6-6"/><path d="M13 7l4 4"/><path d="M8 4l3 3M4 8l3 3M17 15l3 3"/>',
    fill: '<path d="M12 3.5s6.5 6.8 6.5 10.5a6.5 6.5 0 11-13 0C5.5 10.3 12 3.5 12 3.5z"/>',
    dedupe: '<rect x="4" y="4" width="12" height="12" rx="2"/><path d="M8 20h12V8"/>',
    outlier: '<path d="M4 4v16h16"/><circle cx="9" cy="14" r="1.5"/><circle cx="13" cy="10" r="1.5"/><circle cx="19" cy="5" r="1.5"/>',
    columns: '<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="16" rx="1"/><rect x="17" y="4" width="4" height="16" rx="1"/>',
    drop: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 12h8"/>',
    rename: '<path d="M4 20h16"/><path d="M6 16l9-9 3 3-9 9H6z"/>',
    type: '<path d="M5 19l6-14 6 14M8 14h7"/>',
    formula: '<path d="M17 4H8l4.5 8L8 20h9"/>',
    math: '<path d="M4 13h3l3 7 4-16 3 6h4"/>',
    text: '<path d="M5 6h14M12 6v13M9 19h6"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    bin: '<path d="M4 20V10h6v10zM14 20V6h6v14"/><path d="M2 20h20"/>',
    rolling: '<path d="M3 12c3.5-7 6 7 9.5 0S18.5 5 22 12"/>',
    group: '<rect x="3" y="4" width="6" height="5" rx="1"/><path d="M14 5h7M14 10h5M14 15h7M14 20h4"/><path d="M6 9v11h4"/>',
    pivot: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10"/>',
    melt: '<path d="M4 4h16M4 9h16"/><path d="M8 14h8M10 18h4"/>',
    merge: '<rect x="3" y="5" width="8" height="14" rx="2"/><path d="M13 9h5M13 15h5"/><path d="M14 6l3 3-3 3"/>',
    reset: '<path d="M4 12a8 8 0 1014-5.3"/><path d="M20 4v5h-5"/>',

    /* ui */
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 019.5 4 8.5 8.5 0 1020 14.5z"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 2.5 15.4 0 18M12 3c-2.5 2.6-2.5 15.4 0 18"/>',
    download: '<path d="M12 4v11M8 11l4 4 4-4M5 20h14"/>',
    upload: '<path d="M12 20V9M8 13l4-4 4 4M5 4h14"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.6 2.6 0 015 .8c0 1.7-2.5 2-2.5 3.7"/><path d="M12 17.5h.01"/>',
    undo: '<path d="M9 14l-5-5 5-5"/><path d="M4 9h9a7 7 0 010 14H8"/>',
    redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9h-9a7 7 0 000 14h5"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    trash: '<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 5H6a2 2 0 00-2 2v9"/>',
    check: '<path d="M5 13l4.5 4.5L19 7"/>',
    alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    sparkles: '<path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
    eye: '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.6"/>',
    eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 6.2A9.6 9.6 0 0112 6c6.4 0 10 6 10 6a17 17 0 01-3 3.6M6.3 7.6A17 17 0 002 12s3.6 6 10 6c1.3 0 2.5-.3 3.5-.7"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
    chevronRight: '<path d="M9 6l6 6-6 6"/>',
    arrowUp: '<path d="M12 20V4M6 10l6-6 6 6"/>',
    arrowDown: '<path d="M12 4v16M6 14l6 6 6-6"/>',
    grip: '<circle cx="9" cy="6" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="18" r="1.3"/>',
    file: '<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5"/>',
    link: '<path d="M10 13a4 4 0 005.7 0l2.6-2.6a4 4 0 00-5.7-5.7L11 6.3"/><path d="M14 11a4 4 0 00-5.7 0L5.7 13.6a4 4 0 005.7 5.7l1.6-1.6"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="M4 17l5-5 4 4 3-2 4 4"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
    zap: '<path d="M13 3L5 14h5l-1 7 8-11h-5z"/>',
    grid: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>',
    refresh: '<path d="M20 11a8 8 0 10-2.3 5.7"/><path d="M20 5v6h-6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.5l3.5 2"/>',
    switch: '<path d="M4 8h12l-3-3M20 16H8l3 3"/>',
    play: '<path d="M7 4l12 8-12 8z"/>',
    panelDown: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 14h18"/>',
    filterOff: '<path d="M3 5h18l-7 8.5V20l-4-2.2"/><path d="M4 4l16 16"/>',
    github: '<path d="M9 21v-3.5c-3 .6-3.7-1.3-3.7-1.3-.5-1.2-1.3-1.6-1.3-1.6-1-.7 0-.7 0-.7 1.1.1 1.7 1.2 1.7 1.2 1 1.7 2.6 1.2 3.2.9.1-.7.4-1.2.7-1.5-2.4-.3-4.8-1.2-4.8-5.2 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .9-.3 3 1.1a10 10 0 015.4 0c2.1-1.4 3-1.1 3-1.1.5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 4-2.5 4.9-4.9 5.2.4.4.7 1.1.7 2.1V21"/>',
    dot: '<circle cx="12" cy="12" r="3"/>',
    clock2: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 2"/>',
    cut: '<path d="M6 4l10 14M18 4L8 18"/><circle cx="6" cy="20" r="2"/><circle cx="18" cy="20" r="2"/>',
    hashtag: '<path d="M9 4L7 20M17 4l-2 16M4 9h16M3 15h16"/>',
  };

  function icon(name, cls) {
    const body = P[name] || P.dot;
    return `<svg class="${cls || 'ico'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  }

  global.Icons = { icon, PATHS: P };
})(window);
