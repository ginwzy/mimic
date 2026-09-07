export const viewport = { width: 394, height: 749, deviceScaleFactor: 2.75, mobile: true };

export function html(mode) {
  const bands = Array.from({ length: 4 }, (_, index) => `<section id="band${index}">band ${index}</section>`).join('');
  return `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>
      html,body { margin:0; padding:0; }
      body { touch-action:${mode === 'touch-action-none' ? 'none' : 'auto'}; }
      section { height:600px; }
      #box { position:absolute; top:100px; left:0; width:100%; height:520px;
        overflow:auto; overscroll-behavior:contain; }
    </style>${mode === 'nested' ? `<div id="box">${bands}</div>` : bands}`;
}

export function observe(mode) {
  const rows = [];
  const label = value => value?.id || value?.nodeName || null;
  const rect = id => {
    const element = document.getElementById(id);
    if (!element) return null;
    const r = element.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  };
  const snapshot = (tag, x = 190, y = 550) => ({
    tag, scrollX, scrollY, pageXOffset, pageYOffset, innerWidth, innerHeight,
    root: document.scrollingElement ? {
      scrollTop: document.scrollingElement.scrollTop,
      scrollHeight: document.scrollingElement.scrollHeight,
      clientHeight: document.scrollingElement.clientHeight,
    } : null,
    visual: visualViewport ? { pageTop: visualViewport.pageTop, offsetTop: visualViewport.offsetTop, scale: visualViewport.scale } : null,
    boxScrollTop: document.getElementById('box')?.scrollTop ?? null,
    hit: label(document.elementFromPoint?.(x, y)),
    band0: rect('band0'), band1: rect('band1'), box: rect('box'),
  });
  if (mode === 'prevent-touchmove') {
    document.addEventListener('touchmove', event => event.preventDefault(), { capture: true, passive: false });
  }
  for (const type of ['pointerdown', 'pointermove', 'pointercancel', 'pointerup', 'touchstart', 'touchmove', 'touchend', 'scroll']) {
    document.addEventListener(type, event => {
      const p = event.touches?.[0] || event.changedTouches?.[0] || event;
      rows.push({
        type, target: label(event.target), trusted: event.isTrusted,
        cancelable: event.cancelable, prevented: event.defaultPrevented,
        clientY: p.clientY ?? null, pageY: p.pageY ?? null, screenY: p.screenY ?? null,
        clientX: p.clientX ?? null, screenX: p.screenX ?? null,
        ...snapshot('event', p.clientX ?? 190, p.clientY ?? 550),
      });
    }, { capture: true, passive: true });
  }
  globalThis.scrollProbe = { rows, snapshot };
}
