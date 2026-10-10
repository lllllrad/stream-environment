import type { WidgetInstance } from '../contracts/overlay.ts';
import { normalizeWidgetColor } from '../contracts/colors.ts';
export { normalizeWidgetColor } from '../contracts/colors.ts';

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
