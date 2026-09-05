import { SYSTEM_COLOR_NAMES, systemColorKey, type SystemColorsPalette } from './system-colors.shared.js';
export { SYSTEM_COLOR_NAMES, type SystemColorsPalette } from './system-colors.shared.js';

/** BMS pR-equivalent hash input (key order = SYSTEM_COLOR_NAMES). */
export function systemColorsPayload(palette: SystemColorsPalette): Record<string, string> {
  const payload: Record<string, string> = {};
  for (const name of SYSTEM_COLOR_NAMES) payload[name] = palette[name];
  return payload;
}

/** bO(39) seed 5381 — same as BMS / audio fingerprint. */
export function systemColorsBo39(palette: SystemColorsPalette, seed = 5381): string {
  const input = JSON.stringify(systemColorsPayload(palette));
  let h = seed;
  for (let i = 0; i < input.length; i += 1) {
    h = (h * 33) ^ input.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}

export function systemColorLookup(
  palette: SystemColorsPalette,
): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const name of SYSTEM_COLOR_NAMES) {
    map.set(name.toLowerCase(), palette[name]);
  }
  return map;
}

/**
 * Proxy CSSStyleDeclaration so backgroundColor / getPropertyValue reflect the
 * synthetic system color when the element's inline background-color is a keyword.
 */
export function wrapComputedStyle(
  style: object,
  element: unknown,
  lookup: ReadonlyMap<string, string>,
): object {
  const keyword = readBackgroundKeyword(element);
  const override = keyword ? lookup.get(keyword) : undefined;
  if (!override) return style;

  return new Proxy(style, {
    get(target, prop, receiver) {
      if (prop === 'backgroundColor') return override;
      if (prop === 'getPropertyValue') {
        const original = Reflect.get(target, prop, receiver);
        if (typeof original !== 'function') return original;
        return function getPropertyValue(this: unknown, property: unknown): unknown {
          const name = String(property).toLowerCase();
          if (name === 'background-color' || name === 'background') return override;
          return Reflect.apply(original, target, [property]);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function readBackgroundKeyword(element: unknown): string | undefined {
  if (element === null || element === undefined || typeof element !== 'object') return undefined;
  try {
    const style = Reflect.get(element, 'style');
    if (style === null || style === undefined || typeof style !== 'object') return undefined;
    const getPropertyValue = Reflect.get(style, 'getPropertyValue');
    let raw = '';
    if (typeof getPropertyValue === 'function') {
      raw = String(Reflect.apply(getPropertyValue, style, ['background-color']) || '');
    }
    if (!raw) raw = String(Reflect.get(style, 'backgroundColor') || '');
    const key = systemColorKey(raw);
    return key?.toLowerCase();
  } catch {
    return undefined;
  }
}
