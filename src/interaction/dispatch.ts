import type { InteractionFrame } from './types.js';

export function createInteractionSource(frames: readonly InteractionFrame[]): string {
  const json = JSON.stringify(frames);
  return `((frames) => {
    const dispatch = typeof __mimicDispatchTrustedEvent === 'function'
      ? __mimicDispatchTrustedEvent
      : (target, event) => target.dispatchEvent(event);
    const point = (frame) => {
      const width = Math.max(1, Number(screen.width) || Number(innerWidth) || 1);
      const height = Math.max(1, Number(screen.height) || Number(innerHeight) || 1);
      const x = Math.max(0, Math.min(width - 1, Math.round(frame.x * (width - 1))));
      const y = Math.max(0, Math.min(height - 1, Math.round(frame.y * (height - 1))));
      const fields = {
        identifier: 1, target: document,
        clientX: x, clientY: y, pageX: x, pageY: y, screenX: x, screenY: y,
        radiusX: 1, radiusY: 1, rotationAngle: 0, force: frame.phase === 'end' ? 0 : 0.5,
      };
      try { return new globalThis.Touch(fields); }
      catch { return fields; }
    };
    const fallbackEvent = (type, fields, bubbles) => {
      const event = new Event(type, { bubbles, cancelable: true });
      for (const [key, value] of Object.entries(fields)) {
        try { Object.defineProperty(event, key, { configurable: true, enumerable: true, value }); } catch {}
      }
      return event;
    };
    const createEvent = (Constructor, type, fields, bubbles) => {
      try { return new Constructor(type, fields); }
      catch { return fallbackEvent(type, fields, bubbles); }
    };
    const mouseTypes = { down: 'mousedown', move: 'mousemove', up: 'mouseup' };
    const emit = (frame) => {
      try {
        switch (frame.kind) {
          case 'motion': {
            const fields = {
              acceleration: { x: frame.acceleration[0], y: frame.acceleration[1], z: frame.acceleration[2] },
              accelerationIncludingGravity: { x: frame.gravity[0], y: frame.gravity[1], z: frame.gravity[2] },
              rotationRate: { alpha: frame.rotation[0], beta: frame.rotation[1], gamma: frame.rotation[2] },
              interval: frame.interval,
            };
            dispatch(window, createEvent(globalThis.DeviceMotionEvent, 'devicemotion', fields, false));
            return;
          }
          case 'orientation': {
            const fields = { alpha: frame.alpha, beta: frame.beta, gamma: frame.gamma, absolute: false };
            dispatch(window, createEvent(globalThis.DeviceOrientationEvent, 'deviceorientation', fields, false));
            return;
          }
          case 'touch': {
            const p = point(frame);
            const type = 'touch' + frame.phase;
            const active = frame.phase === 'end' ? [] : [p];
            const fields = { bubbles: true, cancelable: true, touches: active, targetTouches: active, changedTouches: [p] };
            dispatch(document, createEvent(globalThis.TouchEvent, type, fields, true));
            return;
          }
          case 'mouse': {
            const p = point(frame);
            const fields = {
              bubbles: true, cancelable: true, view: window,
              clientX: p.clientX, clientY: p.clientY, screenX: p.screenX, screenY: p.screenY,
              button: 0,
              buttons: frame.phase === 'up' ? 0 : 1,
            };
            dispatch(document, createEvent(globalThis.MouseEvent, mouseTypes[frame.phase], fields, true));
          }
        }
      } catch {}
    };
    for (const frame of frames) window.setTimeout(() => emit(frame), frame.at);
    return frames.length;
  })(${json})`;
}
