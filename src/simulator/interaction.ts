import type { Circuit, PinRef, Selection } from '../types';
import { NO_SELECTION } from '../types';
import { snap10 } from '../utils/geometry';
import { selectItem } from '../utils/selection';
import { connect } from './circuit';
import { canConnect } from './engine';

export type Target =
  | { k: 'pin'; pin: PinRef }
  | { k: 'comp'; id: number }
  | { k: 'wire'; id: number }
  | { k: 'empty' };

// `start` is the circuit before the gesture began; cancelling restores it and committing records it.
export type Drag =
  | { t: 'move'; start: Circuit; anchor: { x: number; y: number }; origins: { id: number; x: number; y: number }[]; activate: number | null }
  | { t: 'wire'; start: Circuit; from: PinRef };

export interface Press {
  drag: Drag | null;
  sel: Selection;
  circuit: Circuit;
}

export interface Change {
  next: Circuit;
  before: Circuit;
}

export function press(circuit: Circuit, sel: Selection, target: Target, shift: boolean, world: { x: number; y: number }): Press {
  switch (target.k) {
    case 'empty':
      return { drag: null, sel: shift ? sel : NO_SELECTION, circuit };
    case 'wire':
      return { drag: null, sel: selectItem(sel, 'wires', target.id, shift), circuit };
    case 'comp': {
      if (shift) return { drag: null, sel: selectItem(sel, 'comps', target.id, true), circuit };
      const next = sel.comps.includes(target.id) ? sel : { comps: [target.id], wires: [] };
      const origins = circuit.comps.filter((c) => next.comps.includes(c.id)).map((c) => ({ id: c.id, x: c.x, y: c.y }));
      const pressed = circuit.comps.find((c) => c.id === target.id)!;
      const activate = origins.length === 1 && (pressed.type === 'SW' || pressed.type === 'CLK') ? pressed.id : null;
      return { drag: { t: 'move', start: circuit, anchor: world, origins, activate }, sel: next, circuit };
    }
    case 'pin': {
      let from = target.pin;
      let current = circuit;
      if (from.k === 'i') {
        const old = circuit.wires.find((w) => w.to.c === from.c && w.to.p === from.p);
        if (old) {
          current = { ...circuit, wires: circuit.wires.filter((w) => w !== old) };
          from = { c: old.from.c, k: 'o', p: old.from.p };
        }
      }
      return { drag: { t: 'wire', start: circuit, from }, sel, circuit: current };
    }
  }
}

export function moveSelection(circuit: Circuit, d: Extract<Drag, { t: 'move' }>, world: { x: number; y: number }): Circuit {
  const dx = world.x - d.anchor.x;
  const dy = world.y - d.anchor.y;
  const at = new Map(d.origins.map((o) => [o.id, o]));
  return {
    ...circuit,
    comps: circuit.comps.map((c) => {
      const o = at.get(c.id);
      return o ? { ...c, x: snap10(o.x + dx), y: snap10(o.y + dy) } : c;
    }),
  };
}

// A press without movement on a lone switch or clock is a click on it; anything else never toggles.
export function release(circuit: Circuit, d: Extract<Drag, { t: 'move' }>, moved: boolean): Change | null {
  if (moved) return { next: circuit, before: d.start };
  if (d.activate === null) return null;
  return { next: { ...circuit, comps: circuit.comps.map((c) => (c.id === d.activate ? { ...c, val: c.val ^ 1 } : c)) }, before: circuit };
}

// Dropping on nothing unplugs a dragged wire; dropping on an invalid pin cancels the gesture.
export function finishWire(circuit: Circuit, d: Extract<Drag, { t: 'wire' }>, target: PinRef | null): Change & { error?: string } {
  if (!target) return { next: circuit, before: d.start };
  const [ok, why] = canConnect(circuit, d.from, target);
  if (!ok) return { next: d.start, before: d.start, error: why };
  const [o, i] = d.from.k === 'o' ? [d.from, target] : [target, d.from];
  const same = d.start.wires.some((w) => w.from.c === o.c && w.from.p === o.p && w.to.c === i.c && w.to.p === i.p);
  if (same) return { next: d.start, before: d.start };
  try {
    return { next: connect(circuit, { c: o.c, p: o.p }, { c: i.c, p: i.p }), before: d.start };
  } catch (e) {
    return { next: d.start, before: d.start, error: (e as Error).message };
  }
}
