import { createHash } from 'node:crypto';
import type { Profile } from '../core/types.js';
import type { CapabilityOrigin } from '../core/capabilities.js';
import { SYSTEM_COLOR_NAMES, parseRgb, formatRgb, clampByte, type SystemColorsPalette } from '../features/system-colors.shared.js';

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

export function systemColorsOrigin(profile: Profile): CapabilityOrigin {
  const count = SYSTEM_COLOR_NAMES.filter(name => {
    const value = profile.systemColors?.[name];
    return typeof value === 'string' && parseRgb(value) !== undefined;
  }).length;
  // v2 has no systemColors evidence section; presence alone cannot establish capture.
  return count === 0 ? 'synthetic' : count < SYSTEM_COLOR_NAMES.length ? 'mixed' : 'unknown';
}

