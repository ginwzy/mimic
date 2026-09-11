import type { Target } from '../core/types.js';

export function hasTouchSurface(target: Target): boolean {
  // Android tablets may report UA-CH mobile=false while retaining touch APIs.
  return target.platform === 'android' || target.form === 'mobile';
}

export const TOUCH_FIELDS = [
  'identifier', 'target',
  'screenX', 'screenY', 'clientX', 'clientY', 'pageX', 'pageY',
  'radiusX', 'radiusY', 'rotationAngle', 'force',
] as const;
