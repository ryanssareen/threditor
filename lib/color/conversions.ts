// MIT — threditor color utilities, used by M3 color picker and M10 luminance toggle

export type RGB = readonly [r: number, g: number, b: number];
export type HSL = readonly [h: number, s: number, l: number];

const BYTE_MIN = 0;
const BYTE_MAX = 255;
const HUE_MAX = 360;
const SATURATION_LIGHTNESS_MIN = 0;
const SATURATION_LIGHTNESS_MAX = 1;

const finiteOr = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback;

const clamp = (value: number, min: number, max: number): number => {
  const safeValue = finiteOr(value, min);
  return Math.min(Math.max(safeValue, min), max);
};

const clampByte = (value: number): number => clamp(value, BYTE_MIN, BYTE_MAX);

const clampUnit = (value: number): number =>
  clamp(value, SATURATION_LIGHTNESS_MIN, SATURATION_LIGHTNESS_MAX);

const wrapHue = (value: number): number => {
  const safeValue = finiteOr(value, 0);
  const wrapped = safeValue % HUE_MAX;
  return wrapped < 0 ? wrapped + HUE_MAX : wrapped;
};

const toLinearChannel = (value: number): number => {
  const channel = clampByte(value) / BYTE_MAX;
  return channel <= 0.03928
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
};

const toRgbChannel = (value: number): number =>
  Math.round(clampUnit(value) * BYTE_MAX);

const toGray = (lightness: number): RGB => {
  const channel = toRgbChannel(lightness);
  return [channel, channel, channel];
};

const channelToHex = (value: number): string =>
  Math.floor(clampByte(value)).toString(16).padStart(2, '0');

/**
 * Converts an sRGB color from 8-bit RGB channels to HSL.
 * @param r Red channel in the inclusive range [0, 255].
 * @param g Green channel in the inclusive range [0, 255].
 * @param b Blue channel in the inclusive range [0, 255].
 * @returns A readonly HSL tuple with hue in [0, 360] and saturation/lightness in [0, 1].
 */
export function rgbToHsl(r: number, g: number, b: number): HSL {
  const red = clampByte(r) / BYTE_MAX;
  const green = clampByte(g) / BYTE_MAX;
  const blue = clampByte(b) / BYTE_MAX;

  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const lightness = (max + min) / 2;

  if (delta === 0) {
    return [0, 0, lightness];
  }

  const saturation = delta / (1 - Math.abs(2 * lightness - 1));

  let hueSegment = 0;
  if (max === red) {
    hueSegment = (green - blue) / delta;
  } else if (max === green) {
    hueSegment = (blue - red) / delta + 2;
  } else {
    hueSegment = (red - green) / delta + 4;
  }

  const hue = wrapHue(hueSegment * 60);
  return [hue, saturation, lightness];
}

/**
 * Converts an HSL color to sRGB 8-bit RGB channels.
 * @param h Hue in the inclusive range [0, 360].
 * @param s Saturation in the inclusive range [0, 1].
 * @param l Lightness in the inclusive range [0, 1].
 * @returns A readonly RGB tuple with integer-rounded channels in [0, 255].
 */
export function hslToRgb(h: number, s: number, l: number): RGB {
  const hue = wrapHue(h);
  const saturation = clampUnit(s);
  const lightness = clampUnit(l);

  if (saturation === 0) {
    return toGray(lightness);
  }

  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const huePrime = hue / 60;
  const secondary = chroma * (1 - Math.abs((huePrime % 2) - 1));
  const match = lightness - chroma / 2;

  let red = 0;
  let green = 0;
  let blue = 0;

  if (huePrime < 1) {
    red = chroma;
    green = secondary;
  } else if (huePrime < 2) {
    red = secondary;
    green = chroma;
  } else if (huePrime < 3) {
    green = chroma;
    blue = secondary;
  } else if (huePrime < 4) {
    green = secondary;
    blue = chroma;
  } else if (huePrime < 5) {
    red = secondary;
    blue = chroma;
  } else {
    red = chroma;
    blue = secondary;
  }

  return [
    toRgbChannel(red + match),
    toRgbChannel(green + match),
    toRgbChannel(blue + match),
  ];
}

/**
 * Converts 8-bit RGB channels to a lowercase hex string.
 * @param r Red channel to clamp into the inclusive range [0, 255].
 * @param g Green channel to clamp into the inclusive range [0, 255].
 * @param b Blue channel to clamp into the inclusive range [0, 255].
 * @returns A lowercase "#rrggbb" string with no alpha channel.
 */
export function rgbToHex(r: number, g: number, b: number): string {
  return `#${channelToHex(r)}${channelToHex(g)}${channelToHex(b)}`;
}

/**
 * Parses a hex color string into 8-bit RGB channels.
 * @param hex A case-insensitive hex string in "#RGB", "#RRGGBB", or "#RRGGBBAA" form. The "#" prefix is optional and alpha is ignored.
 * @returns A readonly RGB tuple when parsing succeeds, or null for invalid input.
 */
export function hexToRgb(hex: string): RGB | null {
  const normalized = hex.trim().replace(/^#/, '');

  if (!/^[0-9a-fA-F]+$/.test(normalized)) {
    return null;
  }

  let expanded = normalized;
  if (normalized.length === 3) {
    expanded = normalized
      .split('')
      .map((digit) => `${digit}${digit}`)
      .join('');
  } else if (normalized.length === 8) {
    expanded = normalized.slice(0, 6);
  } else if (normalized.length !== 6) {
    return null;
  }

  const red = Number.parseInt(expanded.slice(0, 2), 16);
  const green = Number.parseInt(expanded.slice(2, 4), 16);
  const blue = Number.parseInt(expanded.slice(4, 6), 16);

  return [red, green, blue];
}

/**
 * Computes WCAG relative luminance for an sRGB color.
 * @param r Red channel in the inclusive range [0, 255].
 * @param g Green channel in the inclusive range [0, 255].
 * @param b Blue channel in the inclusive range [0, 255].
 * @returns A luminance value in the inclusive range [0, 1].
 */
export function luminance(r: number, g: number, b: number): number {
  const red = toLinearChannel(r);
  const green = toLinearChannel(g);
  const blue = toLinearChannel(b);

  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

/**
 * Computes the WCAG contrast ratio between two RGB colors.
 * @param rgb1 The first RGB color.
 * @param rgb2 The second RGB color.
 * @returns The contrast ratio in the inclusive range [1, 21].
 */
export function contrastRatio(rgb1: RGB, rgb2: RGB): number {
  const luminance1 = luminance(rgb1[0], rgb1[1], rgb1[2]);
  const luminance2 = luminance(rgb2[0], rgb2[1], rgb2[2]);

  const lighter = Math.max(luminance1, luminance2);
  const darker = Math.min(luminance1, luminance2);

  return (lighter + 0.05) / (darker + 0.05);
}
