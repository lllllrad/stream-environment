import type { WidgetInstance } from '../contracts/overlay.ts';

export function normalizeWidgetColor(value: string, background = false): string | null {
  const color = value.trim().toLowerCase();
  if (background && color === 'transparent') return color;
  if (/^#[0-9a-f]{6}$/.test(color)) return color;
  if (/^#[0-9a-f]{3}$/.test(color)) return '#' + [...color.slice(1)].map(digit => digit + digit).join('');
  return null;
}

export function normalizeWidgetColors(widgets: WidgetInstance[]): WidgetInstance[] | null {
  const normalized: WidgetInstance[] = [];
  for (const widget of widgets) {
    const background = normalizeWidgetColor(widget.settings.background, true);
    const color = normalizeWidgetColor(widget.settings.color);
    if (background === null || color === null) return null;
    normalized.push({ ...widget, settings: { ...widget.settings, background, color } });
  }
  return normalized;
}
