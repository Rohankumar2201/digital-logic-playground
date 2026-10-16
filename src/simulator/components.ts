import type { Comp, TypeId } from '../types';

export interface Def {
  title: string;
  label: string;
  in: string[];
  out: string[];
  eval: (i: number[], c: Pick<Comp, 'val' | 'q'>) => number[];
  w: number;
  io?: boolean;
  ff?: boolean;
  pn?: boolean;
  next?: (i: number[], q: number) => number;
}

export const defs = {} as Record<TypeId, Def>;

const add = (t: TypeId, title: string, label: string, i: string[], o: string[], ev: Def['eval'], extra: Partial<Def> = {}) => {
  defs[t] = { title, label, in: i, out: o, eval: ev, w: 70, ...extra };
};
const gate = (t: TypeId, f: (a: number, b: number) => number) =>
  add(t, t, t, ['A', 'B'], ['Y'], (i) => [f(i[0], i[1])]);
const ff = (t: TypeId, title: string, label: string, ins: string[], next: Def['next']) =>
  add(t, title, label, [...ins, 'CLK'], ['Q', 'Q̅'], (_, c) => [c.q, 1 - c.q], { ff: true, next, w: 96, pn: true });
const block = (t: TypeId, title: string, label: string, i: string[], o: string[], ev: Def['eval']) =>
  add(t, title, label, i, o, ev, { w: 96, pn: true });

add('SW', 'Switch', 'SW', [], ['Q'], (_, c) => [c.val], { w: 56, io: true });
add('CLK', 'Clock', 'CLK', [], ['CLK'], (_, c) => [c.val], { w: 56, io: true });
add('LED', 'LED', 'LED', ['A'], [], () => [], { w: 56, io: true });

gate('AND', (a, b) => a & b);
gate('OR', (a, b) => a | b);
gate('XOR', (a, b) => a ^ b);
gate('NAND', (a, b) => 1 - (a & b));
gate('NOR', (a, b) => 1 - (a | b));
gate('XNOR', (a, b) => 1 - (a ^ b));
add('NOT', 'NOT', 'NOT', ['A'], ['Y'], (i) => [1 - i[0]]);

ff('DFF', 'D Flip-Flop', 'D-FF', ['D'], (i) => i[0]);
ff('JKFF', 'JK Flip-Flop', 'JK-FF', ['J', 'K'], (i, q) => (i[0] && i[1] ? 1 - q : i[0] ? 1 : i[1] ? 0 : q));
ff('TFF', 'T Flip-Flop', 'T-FF', ['T'], (i, q) => (i[0] ? 1 - q : q));

block('MUX2', '2:1 MUX', 'MUX 2:1', ['D0', 'D1', 'S'], ['Y'], (i) => [i[2] ? i[1] : i[0]]);
block('MUX4', '4:1 MUX', 'MUX 4:1', ['D0', 'D1', 'D2', 'D3', 'S0', 'S1'], ['Y'], (i) => [i[i[4] + 2 * i[5]]]);
block('DEMUX', '1:2 DEMUX', 'DEMUX', ['D', 'S'], ['Y0', 'Y1'], (i) => [i[0] & (1 - i[1]), i[0] & i[1]]);
block('DEC', '2-to-4 Decoder', 'DEC 2:4', ['A0', 'A1'], ['Y0', 'Y1', 'Y2', 'Y3'], (i) =>
  [0, 1, 2, 3].map((n) => +(n === i[0] + 2 * i[1])));
block('ENC', '4-to-2 Encoder', 'ENC 4:2', ['D0', 'D1', 'D2', 'D3'], ['A0', 'A1'], (i) => {
  const n = i[3] ? 3 : i[2] ? 2 : i[1] ? 1 : 0;
  return [n & 1, n >> 1];
});
block('HA', 'Half Adder', 'HA', ['A', 'B'], ['SUM', 'CARRY'], (i) => [i[0] ^ i[1], i[0] & i[1]]);
block('FA', 'Full Adder', 'FA', ['A', 'B', 'Cin'], ['SUM', 'Cout'], (i) => {
  const s = i[0] + i[1] + i[2];
  return [s & 1, s >> 1];
});

export const groups: [string, TypeId[]][] = [
  ['INPUT', ['SW', 'CLK']],
  ['LOGIC', ['AND', 'OR', 'NOT', 'NAND', 'NOR', 'XOR', 'XNOR']],
  ['SEQUENTIAL', ['DFF', 'JKFF', 'TFF']],
  ['BUILDING BLOCKS', ['MUX2', 'MUX4', 'DEMUX', 'DEC', 'ENC', 'HA', 'FA']],
  ['OUTPUT', ['LED']],
];
