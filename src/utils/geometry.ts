import type { Circuit, Comp } from '../types';
import { defs } from '../simulator/components';

export const snap10 = (n: number) => Math.round(n / 10) * 10;
export const pinY = (i: number) => 18 + 22 * i;
export const heightOf = (c: Comp) => 22 * Math.max(defs[c.type].in.length, defs[c.type].out.length, 1) + 14;

export function pinPos(circ: Circuit, id: number, k: 'i' | 'o', p: number): [number, number] {
  const c = circ.comps.find((x) => x.id === id)!;
  return [c.x + (k === 'o' ? defs[c.type].w : 0), c.y + pinY(p)];
}

export function curve(x1: number, y1: number, x2: number, y2: number) {
  const d = Math.max(40, Math.abs(x2 - x1) / 2);
  return `M${x1} ${y1}C${x1 + d} ${y1} ${x2 - d} ${y2} ${x2} ${y2}`;
}
