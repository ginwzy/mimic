import type { InteractionFrame } from './types.js';

export function createInteractionSource(frames: readonly InteractionFrame[]): string {
  const json = JSON.stringify(frames);
  return `((frames) => {
    const PAN_SLOP_PX = 8;
    const POINTER_ID = 2;
    const dispatch = typeof __mimicDispatchTrustedEvent === 'function'
      ? __mimicDispatchTrustedEvent
      : (target, event) => target.dispatchEvent(event);
    let contact = null;
    const coordinates = (frame) => {
      const width = Math.max(1, Number(screen.width) || Number(innerWidth) || 1);
      const height = Math.max(1, Number(screen.height) || Number(innerHeight) || 1);
      const x = Math.max(0, Math.min(width - 1, Math.round(frame.x * (width - 1))));
      const y = Math.max(0, Math.min(height - 1, Math.round(frame.y * (height - 1))));
      const radiusX = Number(frame.radiusX);
      const radiusY = Number(frame.radiusY);
      const force = Number(frame.force);
      const touchForce = Number.isFinite(force) ? Math.max(0, Math.min(1, force)) : 0.5;
      return {
        clientX: x, clientY: y, pageX: x, pageY: y, screenX: x, screenY: y,
        radiusX: Number.isFinite(radiusX) ? Math.max(0, radiusX * width) : 1,
        radiusY: Number.isFinite(radiusY) ? Math.max(0, radiusY * height) : 1,
        force: frame.phase === 'end' ? 0 : touchForce,
      };
    };
    const resolveTarget = (coords) => {
      try {
        const target = document.elementFromPoint?.(coords.clientX, coords.clientY);
        if (target) return target;
      } catch {}
      return document.body || document.documentElement || document;
    };
    const point = (frame, target) => {
      const fields = {
        identifier: 1, target,
        ...coordinates(frame),
        rotationAngle: 0,
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
    const emitPointer = (target, type, p, active) => {
      const boundary = type === 'pointerenter' || type === 'pointerleave';
      const bubbles = !boundary;
      const fields = {
        bubbles, cancelable: !boundary, composed: !boundary, view: window,
        pointerId: POINTER_ID, pointerType: 'touch', isPrimary: true,
        clientX: p.clientX, clientY: p.clientY, screenX: p.screenX, screenY: p.screenY,
        width: active ? Math.max(1, p.radiusX * 2) : 1,
        height: active ? Math.max(1, p.radiusY * 2) : 1,
        pressure: active ? p.force : 0,
        tangentialPressure: 0, tiltX: 0, tiltY: 0, twist: 0,
        button: type === 'pointermove' ? -1 : 0,
        buttons: active ? 1 : 0,
      };
      dispatch(target, createEvent(globalThis.PointerEvent, type, fields, bubbles));
    };
    const closePointer = (target, type, p) => {
      emitPointer(target, type, p, false);
      emitPointer(target, 'pointerout', p, false);
      emitPointer(target, 'pointerleave', p, false);
    };
    const emitTouch = (target, frame, p) => {
      const type = 'touch' + frame.phase;
      const activeTouches = frame.phase === 'end' ? [] : [p];
      const fields = {
        bubbles: true, cancelable: true,
        touches: activeTouches, targetTouches: activeTouches, changedTouches: [p],
      };
      dispatch(target, createEvent(globalThis.TouchEvent, type, fields, true));
    };
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
            const coords = coordinates(frame);
            if (frame.phase === 'start' || contact === null) {
              const target = resolveTarget(coords);
              contact = { target, originX: coords.clientX, originY: coords.clientY, pointerActive: true };
            }
            const p = point(frame, contact.target);
            if (frame.phase === 'start') {
              emitPointer(contact.target, 'pointerover', p, true);
              emitPointer(contact.target, 'pointerenter', p, true);
              emitPointer(contact.target, 'pointerdown', p, true);
              emitTouch(contact.target, frame, p);
              return;
            }
            if (frame.phase === 'move') {
              if (contact.pointerActive) emitPointer(contact.target, 'pointermove', p, true);
              emitTouch(contact.target, frame, p);
              if (contact.pointerActive && Math.hypot(
                p.clientX - contact.originX,
                p.clientY - contact.originY,
              ) >= PAN_SLOP_PX) {
                closePointer(contact.target, 'pointercancel', p);
                contact.pointerActive = false;
              }
              return;
            }
            if (contact.pointerActive) {
              closePointer(contact.target, 'pointerup', p);
            }
            emitTouch(contact.target, frame, p);
            contact = null;
          }
        }
      } catch {}
    };
    for (const frame of frames) window.setTimeout(() => emit(frame), frame.at);
    return frames.length;
  })(${json})`;
}
