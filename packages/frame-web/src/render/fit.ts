/**
 * The frame never scrolls, so each column gets a pixel budget. Items are taken
 * in priority order while they fit; whatever is left becomes a "+N more" chip
 * (which also needs room).
 */
export interface Sized<T> {
  item: T;
  height: number;
}

export interface Fitted<T> {
  shown: T[];
  hidden: number;
}

export const MORE_CHIP_HEIGHT = 44;

export function fitToBudget<T>(
  items: Sized<T>[],
  budget: number,
  gap: number,
  chipHeight = MORE_CHIP_HEIGHT,
): Fitted<T> {
  const shown: T[] = [];
  let used = 0;
  for (const [i, { item, height }] of items.entries()) {
    const next = used + (shown.length ? gap : 0) + height;
    const remaining = items.length - i - 1;
    const reserve = remaining > 0 ? gap + chipHeight : 0;
    if (next + reserve > budget) {
      // The last item may use the room the chip would have taken.
      if (remaining === 0 && next <= budget) shown.push(item);
      break;
    }
    shown.push(item);
    used = next;
  }
  return { shown, hidden: items.length - shown.length };
}
