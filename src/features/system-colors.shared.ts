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

const RGB_RE = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i;

export function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

export function parseRgb(value: string): { r: number; g: number; b: number } | undefined {
  const m = RGB_RE.exec(value.trim());
  if (!m) return undefined;
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
}

export function formatRgb(r: number, g: number, b: number): string {
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

