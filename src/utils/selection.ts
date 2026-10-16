import type { Selection } from '../types';

export const isEmpty = (s: Selection) => s.comps.length === 0 && s.wires.length === 0;

export function selectItem(sel: Selection, kind: 'comps' | 'wires', id: number, additive: boolean): Selection {
  if (!additive) return kind === 'comps' ? { comps: [id], wires: [] } : { comps: [], wires: [id] };
  const list = sel[kind];
  return { ...sel, [kind]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id] };
}
