import type { InteractionFrame } from './types.js';

export function createInteractionSource(
  frames: readonly InteractionFrame[],
  pageOffsetYRatio = 0,
): string {
  const json = JSON.stringify(frames);
  return `((frames, pageOffsetYRatio) => {
    const PAN_SLOP_PX = 8;
    const POINTER_ID = 2;
    const dispatch = typeof __mimicDispatchTrustedEvent === 'function'
      ? __mimicDispatchTrustedEvent
      : (target, event) => target.dispatchEvent(event);
    let contact = null;
    const coordinates = (frame) => {
      const width = Math.max(1, Number(innerWidth) || Number(screen.width) || 1);
      const height = Math.max(1, Number(innerHeight) || Number(screen.height) || 1);
      const x = Math.max(0, Math.min(width - 1, Math.round(frame.x * (width - 1))));
      const y = Math.max(0, Math.min(height - 1, Math.round(frame.y * (height - 1))));
      const pageOffsetYPx = Math.max(0, Math.round(pageOffsetYRatio * (height - 1)));
      const radiusX = Number(frame.radiusX);
      const radiusY = Number(frame.radiusY);
      const force = Number(frame.force);
      const touchForce = Number.isFinite(force) ? Math.max(0, Math.min(1, force)) : 0.5;
      return {
        clientX: x, clientY: y, pageX: x, pageY: y + pageOffsetYPx, screenX: x, screenY: y,
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
      return dispatch(target, createEvent(globalThis.PointerEvent, type, fields, bubbles), p) !== false;
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
      return dispatch(target, createEvent(globalThis.TouchEvent, type, fields, true)) !== false;
    };
    const emitMouse = (target, type, p, buttons) => {
      const boundary = type === 'mouseenter';
      const primaryButton = type === 'mousedown' || type === 'mouseup';
      const bubbles = !boundary;
      const fields = {
        bubbles, cancelable: !boundary, composed: !boundary, view: window,
        detail: primaryButton ? 1 : 0, screenX: p.screenX, screenY: p.screenY,
        clientX: p.clientX, clientY: p.clientY,
        button: 0, buttons,
      };
      const event = createEvent(globalThis.MouseEvent, type, fields, bubbles);
      if (primaryButton) Object.defineProperty(event, 'which', { configurable: true, value: 1 });
      dispatch(target, event, p);
    };
    const emitCompatibilityMouse = (activeContact) => {
      const { target, compatibilityPoint } = activeContact;
      emitMouse(target, 'mouseover', compatibilityPoint, 0);
      emitMouse(target, 'mouseenter', compatibilityPoint, 0);
      if (activeContact.pointerDownAccepted) {
        emitMouse(target, 'mousemove', compatibilityPoint, 0);
        emitMouse(target, 'mousedown', compatibilityPoint, 1);
        emitMouse(target, 'mouseup', compatibilityPoint, 0);
      }
      const fields = {
        bubbles: true, cancelable: true, composed: true, view: window,
        detail: 1,
        pointerId: POINTER_ID, pointerType: 'touch', isPrimary: false,
        clientX: compatibilityPoint.clientX, clientY: compatibilityPoint.clientY,
        screenX: compatibilityPoint.screenX, screenY: compatibilityPoint.screenY,
        width: 1, height: 1, pressure: 0,
        tangentialPressure: 0, tiltX: 0, tiltY: 0, twist: 0,
        button: 0, buttons: 0,
      };
      const click = createEvent(globalThis.PointerEvent, 'click', fields, true);
      Object.defineProperty(click, 'which', { configurable: true, value: 1 });
      dispatch(target, click, compatibilityPoint);
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
              contact.pointerDownAccepted = emitPointer(contact.target, 'pointerdown', p, true);
              contact.touchStartAccepted = emitTouch(contact.target, frame, p);
              contact.compatibilityPoint = p;
              return;
            }
            if (frame.phase === 'move') {
              if (contact.pointerActive) emitPointer(contact.target, 'pointermove', p, true);
              emitTouch(contact.target, frame, p);
              if (contact.pointerActive && Math.hypot(
                p.clientX - contact.originX,
                p.clientY - contact.originY,
              ) > PAN_SLOP_PX) {
                closePointer(contact.target, 'pointercancel', p);
                contact.pointerActive = false;
              }
              return;
            }
            const completedTap = contact.pointerActive;
            if (completedTap) {
              closePointer(contact.target, 'pointerup', p);
            }
            const touchEndAccepted = emitTouch(contact.target, frame, p);
            if (completedTap && contact.touchStartAccepted && touchEndAccepted) {
              emitCompatibilityMouse(contact);
            }
            contact = null;
          }
        }
      } catch {}
    };
    for (const frame of frames) window.setTimeout(() => emit(frame), frame.at);
    return frames.length;
  })(${json}, ${JSON.stringify(pageOffsetYRatio)})`;
}
