import { describe, expect, it } from 'vitest';
import { defs } from '../simulator/components';
import { addComp, canConnect, settle } from '../simulator/engine';
import { connect, parseCircuitFile, removeItems, serializeCircuit, truthTable, truthTableCsv, validateCircuit } from '../simulator/circuit';
import { buildExample, exampleNames } from '../circuits/examples';
import { emptyHistory, record, redo, undo } from '../utils/history';
import type { Circuit, TypeId } from '../types';

const bits = (n: number, width: number) => Array.from({ length: width }, (_, k) => (n >> (width - 1 - k)) & 1);
const dummy = { val: 0, q: 0 };
const evalDef = (t: TypeId, i: number[]) => defs[t].eval(i, dummy);

function build(specs: [TypeId, string?][]): { circ: Circuit; ids: number[] } {
  let circ: Circuit = { comps: [], wires: [], nid: 1 };
  for (const [t, name] of specs) circ = addComp(circ, t, 0, 0, name);
  return { circ, ids: circ.comps.map((c) => c.id) };
}
const setVal = (circ: Circuit, id: number, val: number) => ({ ...circ, comps: circ.comps.map((c) => (c.id === id ? { ...c, val } : c)) });
const q = (circ: Circuit, id: number) => circ.comps.find((c) => c.id === id)!.q;
const run = (circ: Circuit) => settle(circ).circuit;

describe('combinational components', () => {
  const gates: [TypeId, (a: number, b: number) => number][] = [
    ['AND', (a, b) => +(a === 1 && b === 1)],
    ['OR', (a, b) => +(a === 1 || b === 1)],
    ['XOR', (a, b) => +(a !== b)],
    ['NAND', (a, b) => +!(a === 1 && b === 1)],
    ['NOR', (a, b) => +!(a === 1 || b === 1)],
    ['XNOR', (a, b) => +(a === b)],
  ];
  for (const [t, f] of gates) {
    it(`${t} matches its truth table`, () => {
      for (let r = 0; r < 4; r++) {
        const [a, b] = bits(r, 2);
        expect(evalDef(t, [a, b])).toEqual([f(a, b)]);
      }
    });
  }
  it('NOT inverts', () => {
    expect(evalDef('NOT', [0])).toEqual([1]);
    expect(evalDef('NOT', [1])).toEqual([0]);
  });
  it('half adder', () => {
    for (let r = 0; r < 4; r++) {
      const [a, b] = bits(r, 2);
      expect(evalDef('HA', [a, b])).toEqual([a ^ b, a & b]);
    }
  });
  it('full adder satisfies Sum = A^B^Cin and Cout = AB + Cin(A^B)', () => {
    for (let r = 0; r < 8; r++) {
      const [a, b, c] = bits(r, 3);
      expect(evalDef('FA', [a, b, c])).toEqual([a ^ b ^ c, (a & b) | (c & (a ^ b))]);
    }
  });
  it('2:1 and 4:1 multiplexers select the addressed input', () => {
    for (let r = 0; r < 8; r++) {
      const [d0, d1, s] = bits(r, 3);
      expect(evalDef('MUX2', [d0, d1, s])).toEqual([s ? d1 : d0]);
    }
    for (let r = 0; r < 64; r++) {
      const i = bits(r, 6);
      expect(evalDef('MUX4', i)).toEqual([i[i[4] + 2 * i[5]]]);
    }
  });
  it('demux routes D to the selected output only', () => {
    expect(evalDef('DEMUX', [1, 0])).toEqual([1, 0]);
    expect(evalDef('DEMUX', [1, 1])).toEqual([0, 1]);
    expect(evalDef('DEMUX', [0, 1])).toEqual([0, 0]);
  });
  it('decoder is one-hot', () => {
    for (let n = 0; n < 4; n++) {
      expect(evalDef('DEC', [n & 1, n >> 1])).toEqual([0, 1, 2, 3].map((k) => +(k === n)));
    }
  });
  it('encoder gives the highest asserted input', () => {
    expect(evalDef('ENC', [0, 0, 1, 0])).toEqual([0, 1]);
    expect(evalDef('ENC', [1, 1, 0, 1])).toEqual([1, 1]);
    expect(evalDef('ENC', [0, 0, 0, 0])).toEqual([0, 0]);
  });
});

describe('wired simulation', () => {
  it('switches drive an AND gate and an LED', () => {
    let { circ, ids: [a, b, and, led] } = build([['SW'], ['SW'], ['AND'], ['LED']]);
    circ = connect(circ, { c: a, p: 0 }, { c: and, p: 0 });
    circ = connect(circ, { c: b, p: 0 }, { c: and, p: 1 });
    circ = connect(circ, { c: and, p: 0 }, { c: led, p: 0 });
    const ledIn = (c: Circuit) => c.comps.find((x) => x.id === and)!.out[0];
    expect(ledIn(run(circ))).toBe(0);
    expect(ledIn(run(setVal(setVal(circ, a, 1), b, 1)))).toBe(1);
    expect(ledIn(run(setVal(circ, a, 1)))).toBe(0);
  });
  it('every bundled example loads, validates and has no oscillation', () => {
    for (const name of exampleNames) {
      const c = buildExample(name);
      expect(validateCircuit(c)).toEqual([]);
      expect(settle(c).stable).toBe(true);
    }
  });
  it('detects a three-inverter ring as unstable', () => {
    let { circ, ids: [n1, n2, n3] } = build([['NOT'], ['NOT'], ['NOT']]);
    circ = connect(circ, { c: n1, p: 0 }, { c: n2, p: 0 });
    circ = connect(circ, { c: n2, p: 0 }, { c: n3, p: 0 });
    circ = connect(circ, { c: n3, p: 0 }, { c: n1, p: 0 });
    expect(settle(circ).stable).toBe(false);
  });
});

describe('sequential components', () => {
  const setup = (ff: TypeId, inputs: number) => {
    const specs: [TypeId][] = [...Array.from({ length: inputs }, () => ['SW'] as [TypeId]), ['SW'], [ff]];
    const { circ, ids } = build(specs);
    const target = ids[ids.length - 1];
    let c = circ;
    ids.slice(0, -1).forEach((id, p) => (c = connect(c, { c: id, p: 0 }, { c: target, p })));
    return { c, ids, target };
  };
  it('D flip-flop captures D only on the rising edge', () => {
    const { c, ids, target } = setup('DFF', 1);
    const [d, clk] = ids;
    let s = run(setVal(c, d, 1));
    expect(q(s, target)).toBe(0);
    s = run(setVal(s, clk, 1));
    expect(q(s, target)).toBe(1);
    s = run(setVal(s, d, 0));
    expect(q(s, target)).toBe(1);
    s = run(setVal(s, clk, 0));
    expect(q(s, target)).toBe(1);
    s = run(setVal(s, clk, 1));
    expect(q(s, target)).toBe(0);
  });
  it('outputs Q and Q-bar are complementary', () => {
    const { c, ids, target } = setup('DFF', 1);
    const s = run(setVal(setVal(c, ids[0], 1), ids[1], 1));
    expect(s.comps.find((x) => x.id === target)!.out).toEqual([1, 0]);
  });
  it('JK flip-flop: hold, reset, set, toggle', () => {
    const { c, ids, target } = setup('JKFF', 2);
    const [j, k, clk] = ids;
    const pulse = (s: Circuit, jv: number, kv: number) =>
      run(setVal(run(setVal(setVal(setVal(s, j, jv), k, kv), clk, 1)), clk, 0));
    let s = pulse(c, 1, 0);
    expect(q(s, target)).toBe(1);
    s = pulse(s, 0, 0);
    expect(q(s, target)).toBe(1);
    s = pulse(s, 1, 1);
    expect(q(s, target)).toBe(0);
    s = pulse(s, 1, 1);
    expect(q(s, target)).toBe(1);
    s = pulse(s, 0, 1);
    expect(q(s, target)).toBe(0);
  });
  it('T flip-flop toggles only while T is 1', () => {
    const { c, ids, target } = setup('TFF', 1);
    const [t, clk] = ids;
    const pulse = (s: Circuit, tv: number) => run(setVal(run(setVal(setVal(s, t, tv), clk, 1)), clk, 0));
    let s = pulse(c, 1);
    expect(q(s, target)).toBe(1);
    s = pulse(s, 0);
    expect(q(s, target)).toBe(1);
    s = pulse(s, 1);
    expect(q(s, target)).toBe(0);
  });
  it('chained flip-flops shift on one edge instead of racing through', () => {
    let { circ, ids: [d, clk, f1, f2] } = build([['SW'], ['SW'], ['DFF'], ['DFF']]);
    circ = connect(circ, { c: d, p: 0 }, { c: f1, p: 0 });
    circ = connect(circ, { c: clk, p: 0 }, { c: f1, p: 1 });
    circ = connect(circ, { c: clk, p: 0 }, { c: f2, p: 1 });
    circ = connect(circ, { c: f1, p: 0 }, { c: f2, p: 0 });
    let s = run(setVal(circ, d, 1));
    s = run(setVal(s, clk, 1));
    expect([q(s, f1), q(s, f2)]).toEqual([1, 0]);
    s = run(setVal(setVal(s, clk, 0), clk, 0));
    s = run(setVal(s, clk, 1));
    expect([q(s, f1), q(s, f2)]).toEqual([1, 1]);
  });
});

describe('connection validation', () => {
  const { circ, ids: [sw, and, led] } = build([['SW'], ['AND'], ['LED']]);
  it('rejects output-to-output, input-to-input, self and duplicate drivers', () => {
    expect(canConnect(circ, { c: sw, k: 'o', p: 0 }, { c: and, k: 'o', p: 0 })[0]).toBe(false);
    expect(canConnect(circ, { c: and, k: 'i', p: 0 }, { c: led, k: 'i', p: 0 })[0]).toBe(false);
    expect(canConnect(circ, { c: and, k: 'o', p: 0 }, { c: and, k: 'i', p: 0 })[0]).toBe(false);
    const wired = connect(circ, { c: sw, p: 0 }, { c: and, p: 0 });
    expect(() => connect(wired, { c: sw, p: 0 }, { c: and, p: 0 })).toThrow('already driven');
  });
  it('rejects pins that do not exist', () => {
    expect(() => connect(circ, { c: sw, p: 3 }, { c: and, p: 0 })).toThrow();
    expect(() => connect(circ, { c: sw, p: 0 }, { c: and, p: 5 })).toThrow();
    expect(() => connect(circ, { c: 999, p: 0 }, { c: and, p: 0 })).toThrow();
  });
  it('allows one output to fan out', () => {
    let c = connect(circ, { c: sw, p: 0 }, { c: and, p: 0 });
    c = connect(c, { c: sw, p: 0 }, { c: and, p: 1 });
    expect(validateCircuit(c)).toEqual([]);
  });
});

describe('deletion and undo', () => {
  const make = () => {
    let { circ, ids: [a, b, and, led] } = build([['SW'], ['SW'], ['AND'], ['LED']]);
    circ = connect(circ, { c: a, p: 0 }, { c: and, p: 0 });
    circ = connect(circ, { c: b, p: 0 }, { c: and, p: 1 });
    circ = connect(circ, { c: and, p: 0 }, { c: led, p: 0 });
    return { circ, a, b, and, led };
  };
  it('deleting a component removes all of its wires and leaves no dangling references', () => {
    const { circ, and } = make();
    const after = removeItems(circ, { comps: [and], wires: [] });
    expect(after.comps).toHaveLength(3);
    expect(after.wires).toHaveLength(0);
    expect(validateCircuit(after)).toEqual([]);
  });
  it('deleting a wire keeps both endpoints and unrelated wires', () => {
    const { circ } = make();
    const after = removeItems(circ, { comps: [], wires: [circ.wires[0].id] });
    expect(after.comps).toHaveLength(4);
    expect(after.wires).toHaveLength(2);
  });
  it('multi-selection of components and wires is one consistent operation', () => {
    const { circ, a, led } = make();
    const after = removeItems(circ, { comps: [a, led], wires: [circ.wires[1].id] });
    expect(after.comps.map((c) => c.id)).toEqual([circ.comps[1].id, circ.comps[2].id]);
    expect(after.wires).toHaveLength(0);
    expect(validateCircuit(after)).toEqual([]);
  });
  it('undo restores a deleted component together with its wires, redo removes it again', () => {
    const { circ, and } = make();
    let h = record(emptyHistory<Circuit>(), circ);
    const deleted = removeItems(circ, { comps: [and], wires: [] });
    const back = undo(h, deleted)!;
    expect(back.state).toEqual(circ);
    expect(back.state.wires).toHaveLength(3);
    h = back.history;
    const forward = redo(h, back.state)!;
    expect(forward.state).toEqual(deleted);
  });
  it('recording a new edit discards the redo branch and respects the limit', () => {
    let h = emptyHistory<number>();
    for (let i = 0; i < 150; i++) h = record(h, i, 100);
    expect(h.past).toHaveLength(100);
    h = undo(h, 150)!.history;
    expect(h.future).toHaveLength(1);
    expect(record(h, 7).future).toHaveLength(0);
  });
});

describe('truth table generator', () => {
  it('derives rows from the simulated circuit', () => {
    let { circ, ids: [a, b, xor, led] } = build([['SW', 'A'], ['SW', 'B'], ['XOR'], ['LED', 'Y']]);
    circ = connect(circ, { c: a, p: 0 }, { c: xor, p: 0 });
    circ = connect(circ, { c: b, p: 0 }, { c: xor, p: 1 });
    circ = connect(circ, { c: xor, p: 0 }, { c: led, p: 0 });
    const t = truthTable(circ);
    expect(t.ok && t.rows.map((r) => [...r.in, ...r.out])).toEqual([[0, 0, 0], [0, 1, 1], [1, 0, 1], [1, 1, 0]]);
    expect(t.ok && truthTableCsv(t)).toBe('A,B,Y\n0,0,0\n0,1,1\n1,0,1\n1,1,0\n');
  });
  it('covers all outputs of the full adder example', () => {
    const t = truthTable(buildExample('Full adder'));
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.rows).toHaveLength(8);
    for (const r of t.rows) expect(r.out).toEqual([(r.in[0] + r.in[1] + r.in[2]) & 1, (r.in[0] + r.in[1] + r.in[2]) >> 1]);
  });
  it('refuses sequential circuits and circuits with no IO', () => {
    expect(truthTable(buildExample('D flip-flop')).ok).toBe(false);
    expect(truthTable({ comps: [], wires: [], nid: 1 }).ok).toBe(false);
  });
  it('refuses more inputs than the safety limit', () => {
    const specs: [TypeId][] = Array.from({ length: 11 }, () => ['SW']);
    const { circ } = build([...specs, ['LED']]);
    expect(truthTable(circ).ok).toBe(false);
  });
});

describe('circuit files', () => {
  const view = { x: 10, y: 20, k: 1.5 };
  it('round-trips components, wires, positions and switch state', () => {
    const c = settle({ ...buildExample('Half adder'), comps: buildExample('Half adder').comps.map((x) => (x.type === 'SW' ? { ...x, val: 1 } : x)) }).circuit;
    const r = parseCircuitFile(serializeCircuit(c, view));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.circuit).toEqual(c);
    expect(r.view).toEqual(view);
  });
  it('accepts files saved before versioning', () => {
    const legacy = JSON.stringify({ circuit: buildExample('AND gate'), view });
    expect(parseCircuitFile(legacy).ok).toBe(true);
  });
  const bad: [string, string][] = [
    ['not json', '{oops'],
    ['wrong shape', '[]'],
    ['future version', JSON.stringify({ version: 99, circuit: { comps: [], wires: [], nid: 1 } })],
    ['unknown type', JSON.stringify({ circuit: { comps: [{ id: 1, type: 'constructor', x: 0, y: 0 }], wires: [], nid: 2 } })],
    ['missing position', JSON.stringify({ circuit: { comps: [{ id: 1, type: 'AND' }], wires: [], nid: 2 } })],
    ['dangling wire', JSON.stringify({ circuit: { comps: [{ id: 1, type: 'AND', x: 0, y: 0 }], wires: [{ id: 2, from: { c: 9, p: 0 }, to: { c: 1, p: 0 } }], nid: 3 } })],
    ['duplicate ids', JSON.stringify({ circuit: { comps: [{ id: 1, type: 'AND', x: 0, y: 0 }, { id: 1, type: 'OR', x: 0, y: 0 }], wires: [], nid: 2 } })],
  ];
  for (const [name, text] of bad) {
    it(`rejects malformed input: ${name}`, () => {
      expect(parseCircuitFile(text).ok).toBe(false);
    });
  }
});
