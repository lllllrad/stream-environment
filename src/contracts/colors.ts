export const HEX_COLOR_PATTERN = '^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$';
export const BACKGROUND_COLOR_PATTERN = '^(?:#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|transparent)$';

export function normalizeWidgetColor(value: string, background = false): string | null {
  const color = value.trim().toLowerCase();
  if (background && color === 'transparent') return color;
  if (/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/.test(color)) return color;
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{4})$/.test(color)) return '#' + [...color.slice(1)].map(digit => digit + digit).join('');
  return null;
}

export function widgetColorAlpha(value: string): number {
  const color = normalizeWidgetColor(value, true);
  if (color === 'transparent') return 0;
  return color?.length === 9 ? parseInt(color.slice(-2), 16) / 255 : 1;
}
