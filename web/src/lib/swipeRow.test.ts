import {afterEach,expect,it,vi} from 'vitest';
import {clearSwipeRow,closeOpenSwipeRow,registerSwipeRow,resolveSwipeAxis,resolveSwipeTarget} from './swipeRow';

const actionsWidth = 96;

afterEach(() => {
  closeOpenSwipeRow();
});

it('settles past the halfway point and springs back before it', () => {
  expect(resolveSwipeTarget({currentX: -60, actionsWidth, velocityX: 0})).toBe(-actionsWidth);
  expect(resolveSwipeTarget({currentX: -30, actionsWidth, velocityX: 0})).toBe(0);
});

it('lets a flick decide regardless of distance travelled', () => {
  expect(resolveSwipeTarget({currentX: -10, actionsWidth, velocityX: -1.2})).toBe(-actionsWidth);
  expect(resolveSwipeTarget({currentX: -90, actionsWidth, velocityX: 1.2})).toBe(0);
});

it('never settles outside the action tray', () => {
  expect(resolveSwipeTarget({currentX: -400, actionsWidth, velocityX: 0})).toBe(-actionsWidth);
  expect(resolveSwipeTarget({currentX: 200, actionsWidth, velocityX: 0})).toBe(0);
});

it('defers the axis until the gesture clears the slop, then locks it', () => {
  expect(resolveSwipeAxis(3, 4)).toBeNull();
  expect(resolveSwipeAxis(-20, 6)).toBe('x');
  expect(resolveSwipeAxis(-6, 20)).toBe('y');
});

it('keeps only one row open at a time', () => {
  const first = vi.fn();
  const second = vi.fn();
  registerSwipeRow(first);
  registerSwipeRow(second);
  expect(first).toHaveBeenCalledTimes(1);

  closeOpenSwipeRow();
  expect(second).toHaveBeenCalledTimes(1);

  clearSwipeRow(second);
  closeOpenSwipeRow();
  expect(second).toHaveBeenCalledTimes(1);
});
