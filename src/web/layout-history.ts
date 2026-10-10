import type { WidgetInstance } from '../contracts/overlay.ts';

export type LayoutDraft = { widgets: WidgetInstance[]; selected: string };
export type LayoutHistory = { present: LayoutDraft; baseline: WidgetInstance[]; past: LayoutDraft[]; future: LayoutDraft[]; grouped: boolean; recorded: boolean };
export type LayoutHistoryAction =
  | { type: 'reset' | 'saved'; widgets: WidgetInstance[] }
  | { type: 'select'; id: string }
  | { type: 'begin' | 'end' | 'undo' | 'redo' }
  | { type: 'edit'; update: (widgets: WidgetInstance[]) => WidgetInstance[] };

const limit = 100;
const equal = (a: WidgetInstance[], b: WidgetInstance[]) => JSON.stringify(a) === JSON.stringify(b);
export const emptyLayoutHistory: LayoutHistory = { present: { widgets: [], selected: 'now' }, baseline: [], past: [], future: [], grouped: false, recorded: false };
export const layoutIsDirty = (state: LayoutHistory) => !equal(state.present.widgets, state.baseline);

export function layoutHistoryReducer(state: LayoutHistory, action: LayoutHistoryAction): LayoutHistory {
  if (action.type === 'reset' || action.type === 'saved') {
    const widgets = structuredClone(action.widgets);
    const selected = widgets.some(w => w.id === state.present.selected) ? state.present.selected : widgets[0]?.id ?? '';
    return { ...(action.type === 'saved' ? state : emptyLayoutHistory), present: { widgets, selected }, baseline: widgets, grouped: false, recorded: false };
  }
  if (action.type === 'select') return { ...state, present: { ...state.present, selected: action.id } };
  if (action.type === 'begin') return { ...state, grouped: true, recorded: false };
  if (action.type === 'end') return { ...state, grouped: false, recorded: false };
  if (action.type === 'edit') {
    const widgets = action.update(state.present.widgets);
    if (equal(widgets, state.present.widgets)) return state;
    return { ...state, present: { ...state.present, widgets }, past: state.grouped && state.recorded ? state.past : [...state.past, state.present].slice(-limit), future: [], recorded: state.grouped };
  }
  if (action.type === 'undo') {
    const previous = state.past.at(-1);
    if (!previous) return { ...state, grouped: false, recorded: false };
    return { ...state, present: previous, past: state.past.slice(0,-1), future: [...state.future, state.present].slice(-limit), grouped: false, recorded: false };
  }
  const next = state.future.at(-1);
  if (!next) return { ...state, grouped: false, recorded: false };
  return { ...state, present: next, past: [...state.past, state.present].slice(-limit), future: state.future.slice(0,-1), grouped: false, recorded: false };
}
