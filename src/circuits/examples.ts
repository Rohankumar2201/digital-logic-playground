import type { Circuit, TypeId } from '../types';
import { addComp, settle } from '../simulator/engine';

type Spec = { c: [TypeId, number, number, string?][]; w: [number, number, number, number][] };

const twoInput = (gate: TypeId): Spec => ({
  c: [['SW', 40, 50, 'A'], ['SW', 40, 130, 'B'], [gate, 200, 80], ['LED', 340, 90, 'Y']],
  w: [[0, 0, 2, 0], [1, 0, 2, 1], [2, 0, 3, 0]],
});

const EXAMPLES: Record<string, Spec> = {
  'AND gate': twoInput('AND'),
  'XOR gate': twoInput('XOR'),
  'Half adder': {
    c: [['SW', 40, 50, 'A'], ['SW', 40, 130, 'B'], ['HA', 200, 70], ['LED', 360, 60, 'SUM'], ['LED', 360, 120, 'CARRY']],
    w: [[0, 0, 2, 0], [1, 0, 2, 1], [2, 0, 3, 0], [2, 1, 4, 0]],
  },
  'Full adder': {
    c: [['SW', 40, 40, 'A'], ['SW', 40, 100, 'B'], ['SW', 40, 160, 'Cin'], ['FA', 200, 80], ['LED', 360, 70, 'Sum'], ['LED', 360, 130, 'Cout']],
    w: [[0, 0, 3, 0], [1, 0, 3, 1], [2, 0, 3, 2], [3, 0, 4, 0], [3, 1, 5, 0]],
  },
  '4:1 MUX': {
    c: [['SW', 40, 30, 'D0'], ['SW', 40, 90, 'D1'], ['SW', 40, 150, 'D2'], ['SW', 40, 210, 'D3'],
        ['SW', 40, 290, 'S0'], ['SW', 40, 350, 'S1'], ['MUX4', 220, 140], ['LED', 400, 190, 'Y']],
    w: [[0, 0, 6, 0], [1, 0, 6, 1], [2, 0, 6, 2], [3, 0, 6, 3], [4, 0, 6, 4], [5, 0, 6, 5], [6, 0, 7, 0]],
  },
  'D flip-flop': {
    c: [['SW', 40, 60, 'D'], ['CLK', 40, 140], ['DFF', 200, 80], ['LED', 360, 70, 'Q'], ['LED', 360, 130, 'Q̅']],
    w: [[0, 0, 2, 0], [1, 0, 2, 1], [2, 0, 3, 0], [2, 1, 4, 0]],
  },
};

export const exampleNames = Object.keys(EXAMPLES);

export function buildExample(name: string): Circuit {
  const spec = EXAMPLES[name];
  let circ: Circuit = { comps: [], wires: [], nid: 1 };
  for (const [t, x, y, n] of spec.c) circ = addComp(circ, t, x, y, n);
  const ids = circ.comps.map((c) => c.id);
  for (const [a, p, b, q] of spec.w) {
    circ = { ...circ, nid: circ.nid + 1, wires: [...circ.wires, { id: circ.nid, from: { c: ids[a], p }, to: { c: ids[b], p: q } }] };
  }
  return settle(circ).circuit;
}
