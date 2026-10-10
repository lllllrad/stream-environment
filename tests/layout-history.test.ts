import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, type WidgetInstance } from '../src/contracts/overlay.ts';
import { emptyLayoutHistory, layoutHistoryReducer as reduce, layoutIsDirty } from '../src/web/layout-history.ts';

const widgets: WidgetInstance[] = [{ id: 'now', type: 'now', x: 100, y: 20, width: 400, height: 240, visible: true, settings: { ...DEFAULT_SETTINGS } }];
const position = (x: number) => ({ type: 'edit' as const, update: (current: WidgetInstance[]) => current.map(w => ({ ...w, x })) });

test('one continuous gesture undoes and redoes all intermediate moves, while no-op gestures retain redo', () => {
  let state = reduce(emptyLayoutHistory, { type: 'reset', widgets });
  state = reduce(state, { type: 'begin' });
  for (const x of [110, 120, 130]) state = reduce(state, position(x));
  state = reduce(state, { type: 'end' });
  assert.equal(state.past.length, 1);
  assert.equal(layoutIsDirty(state), true);
  state = reduce(state, { type: 'undo' });
  assert.deepEqual(state.present.widgets, widgets);
  assert.equal(layoutIsDirty(state), false);
  state = reduce(state, { type: 'begin' });
  state = reduce(state, position(100));
  state = reduce(state, { type: 'end' });
  assert.equal(state.past.length, 0);
  state = reduce(state, { type: 'redo' });
  assert.equal(state.present.widgets[0].x, 130);
  state = reduce(state, { type: 'undo' });
  state = reduce(state, position(140));
  assert.equal(state.future.length, 0);
});

test('undo restores removed widget settings, order and selection; saving retains history against a new baseline', () => {
  const original = [...widgets, { ...widgets[0], id: 'other', settings: { ...DEFAULT_SETTINGS, background: '#8BF8' } }];
  let state = reduce(emptyLayoutHistory, { type: 'reset', widgets: original });
  state = reduce(state, { type: 'select', id: 'other' });
  state = reduce(state, { type: 'edit', update: current => current.filter(w => w.id !== 'other') });
  state = reduce(state, { type: 'select', id: '' });
  state = reduce(state, { type: 'saved', widgets: state.present.widgets });
  assert.equal(layoutIsDirty(state), false);
  state = reduce(state, { type: 'undo' });
  assert.deepEqual(state.present, { widgets: original, selected: 'other' });
  assert.equal(layoutIsDirty(state), true);
  state = reduce(state, { type: 'redo' });
  assert.deepEqual(state.present.widgets, widgets);
  assert.equal(layoutIsDirty(state), false);
});

test('history is bounded and switching or reloading layouts clears both undo and redo', () => {
  let state = reduce(emptyLayoutHistory, { type: 'reset', widgets });
  for (let x = 101; x <= 210; x++) state = reduce(state, position(x));
  assert.equal(state.past.length, 100);
  for (let i = 0; i < 101; i++) state = reduce(state, { type: 'undo' });
  assert.equal(state.present.widgets[0].x, 110);
  assert.equal(state.future.length, 100);
  state = reduce(state, { type: 'reset', widgets: [{ ...widgets[0], id: 'away' }] });
  assert.equal(state.present.selected, 'away');
  assert.equal(state.past.length, 0);
  assert.equal(state.future.length, 0);
  assert.equal(layoutIsDirty(state), false);
});
