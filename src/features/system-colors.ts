import { createHash } from 'node:crypto';
import type { Profile } from '../core/types.js';

/**
 * BMS pR() system-color list (order fixed — forEach insertion order in JSON.stringify).
 * See live deobf: ActiveBorder … WindowText.
 */
export const SYSTEM_COLOR_NAMES = [
  'ActiveBorder',
  'ActiveCaption',
  'ActiveText',
  'AppWorkspace',
  'Background',
  'ButtonBorder',
  'ButtonFace',
  'ButtonHighlight',
  'ButtonShadow',
  'ButtonText',
  'Canvas',
  'CanvasText',
  'CaptionText',
  'Field',
  'FieldText',
  'GrayText',
  'Highlight',
  'HighlightText',
  'InactiveBorder',
  'InactiveCaption',
  'InactiveCaptionText',
  'InfoBackground',
  'InfoText',
  'LinkText',
  'Mark',
  'MarkText',
  'Menu',
  'MenuText',
  'Scrollbar',
  'ThreeDDarkShadow',
  'ThreeDFace',
  'ThreeDHighlight',
  'ThreeDLightShadow',
  'ThreeDShadow',
  'VisitedText',
  'Window',
  'WindowFrame',
  'WindowText',
] as const;

export type SystemColorName = (typeof SYSTEM_COLOR_NAMES)[number];
export type SystemColorsPalette = Record<SystemColorName, string>;

/** Chrome-like light system colors (not jsdom's gray sandbox defaults). */
const ANDROID_LIGHT_BASE: SystemColorsPalette = {
  ActiveBorder: 'rgb(118, 118, 118)',
  ActiveCaption: 'rgb(255, 255, 255)',
  ActiveText: 'rgb(255, 0, 0)',
  AppWorkspace: 'rgb(255, 255, 255)',
  Background: 'rgb(255, 255, 255)',
  ButtonBorder: 'rgb(118, 118, 118)',
  ButtonFace: 'rgb(240, 240, 240)',
  ButtonHighlight: 'rgb(255, 255, 255)',
  ButtonShadow: 'rgb(160, 160, 160)',
  ButtonText: 'rgb(0, 0, 0)',
  Canvas: 'rgb(255, 255, 255)',
  CanvasText: 'rgb(0, 0, 0)',
  CaptionText: 'rgb(0, 0, 0)',
  Field: 'rgb(255, 255, 255)',
  FieldText: 'rgb(0, 0, 0)',
  GrayText: 'rgb(128, 128, 128)',
  Highlight: 'rgb(0, 120, 215)',
  HighlightText: 'rgb(255, 255, 255)',
  InactiveBorder: 'rgb(118, 118, 118)',
  InactiveCaption: 'rgb(255, 255, 255)',
  InactiveCaptionText: 'rgb(128, 128, 128)',
  InfoBackground: 'rgb(255, 255, 225)',
  InfoText: 'rgb(0, 0, 0)',
  LinkText: 'rgb(0, 0, 238)',
  Mark: 'rgb(255, 255, 0)',
  MarkText: 'rgb(0, 0, 0)',
  Menu: 'rgb(255, 255, 255)',
  MenuText: 'rgb(0, 0, 0)',
  Scrollbar: 'rgb(255, 255, 255)',
  ThreeDDarkShadow: 'rgb(105, 105, 105)',
  ThreeDFace: 'rgb(240, 240, 240)',
  ThreeDHighlight: 'rgb(255, 255, 255)',
  ThreeDLightShadow: 'rgb(227, 227, 227)',
  ThreeDShadow: 'rgb(160, 160, 160)',
  VisitedText: 'rgb(85, 26, 139)',
  Window: 'rgb(255, 255, 255)',
  WindowFrame: 'rgb(100, 100, 100)',
  WindowText: 'rgb(0, 0, 0)',
};

const RGB_RE = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i;

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function parseRgb(value: string): { r: number; g: number; b: number } | undefined {
  const m = RGB_RE.exec(value.trim());
  if (!m) return undefined;
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
}

function formatRgb(r: number, g: number, b: number): string {
  return `rgb(${clampByte(r)}, ${clampByte(g)}, ${clampByte(b)})`;
}

/** Normalize keyword from element.style.backgroundColor (jsdom → lowercase). */
export function systemColorKey(raw: string): SystemColorName | undefined {
  const lower = raw.trim().toLowerCase();
  for (const name of SYSTEM_COLOR_NAMES) {
    if (name.toLowerCase() === lower) return name;
  }
  return undefined;
}

/**
 * Deterministic palette from profile id — leaves the jsdom cluster `947d9249`.
 * Same id → same map; different ids diverge via small per-channel jitter.
 */
export function synthesizeSystemColors(id: string): SystemColorsPalette {
  const buf = createHash('sha256').update(`system-colors:${id}`).digest();
  const out = {} as SystemColorsPalette;
  for (let i = 0; i < SYSTEM_COLOR_NAMES.length; i += 1) {
    const name = SYSTEM_COLOR_NAMES[i]!;
    const base = parseRgb(ANDROID_LIGHT_BASE[name]) ?? { r: 128, g: 128, b: 128 };
    // ±8 on each channel from digest bytes (stable, not session-random).
    const r = clampByte(base.r + (buf[i % 32]! % 17) - 8);
    const g = clampByte(base.g + (buf[(i + 11) % 32]! % 17) - 8);
    const b = clampByte(base.b + (buf[(i + 23) % 32]! % 17) - 8);
    out[name] = formatRgb(r, g, b);
  }
  return out;
}

/** Prefer profile.systemColors (partial ok); missing names filled from synthetic base. */
export function resolveSystemColors(profile: Profile): SystemColorsPalette {
  const base = synthesizeSystemColors(profile.id);
  const raw = profile.systemColors;
  if (!raw) return base;
  const out = { ...base };
  for (const name of SYSTEM_COLOR_NAMES) {
    const value = raw[name];
    if (typeof value === 'string' && parseRgb(value)) out[name] = formatRgb(
      parseRgb(value)!.r,
      parseRgb(value)!.g,
      parseRgb(value)!.b,
    );
  }
  return out;
}

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
