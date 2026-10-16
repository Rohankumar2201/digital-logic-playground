import { describe, expect, it } from 'vitest';
import { buildExample } from '../circuits/examples';
import { MAX_COMPONENTS, circuitsEqual, connect, parseCircuitFile, removeItems, serializeCircuit, truthTable, validateCircuit } from '../simulator/circuit';
import { commit, newEditor, step } from '../simulator/edit';
import type { Editor } from '../simulator/edit';
import { addComp, settle } from '../simulator/engine';
import { finishWire, moveSelection, press, release } from '../simulator/interaction';
import { NO_SELECTION } from '../types';
import type { Circuit, TypeId } from '../types';
import { isControl, isTyping } from '../utils/keyboard';

const view = { x: 10, y: 20, k: 1 };
const world = { x: 0, y: 0 };
const EMPTY: Circuit = { comps: [], wires: [], nid: 1 };

type Json = ReturnType<typeof JSON.parse>;
const base = (): Json => JSON.parse(serializeCircuit(buildExample('AND gate'), view));
const mutated = (f: (o: Json) => void) => {
  const o = base();
  f(o);
  return JSON.stringify(o);
};

function deepFreeze<T>(o: T): T {
  if (typeof o === 'object' && o !== null && !Object.isFrozen(o)) {
    Object.freeze(o);
    Object.values(o).forEach(deepFreeze);
  }
  return o;
}

function build(specs: [TypeId, string?][]) {
  let circ = EMPTY;
  for (const [t, n] of specs) circ = addComp(circ, t, 0, 0, n);
  return { circ, ids: circ.comps.map((c) => c.id) };
}

describe('import validation', () => {
  const rejected: [string, string][] = [
    ['negative component id', mutated((o) => (o.circuit.comps[0].id = -1))],
    ['zero component id', mutated((o) => (o.circuit.comps[0].id = 0))],
    ['fractional component id', mutated((o) => (o.circuit.comps[0].id = 1.5))],
    ['duplicate component ids', mutated((o) => (o.circuit.comps[1].id = o.circuit.comps[0].id))],
    ['duplicate wire ids', mutated((o) => (o.circuit.wires[1].id = o.circuit.wires[0].id))],
    ['negative pin index', mutated((o) => (o.circuit.wires[0].to.p = -1))],
    ['fractional pin index', mutated((o) => (o.circuit.wires[0].to.p = 0.5))],
    ['pin index past the component', mutated((o) => (o.circuit.wires[0].to.p = 5))],
    ['infinite coordinate', JSON.stringify(base()).replace('"x":40', '"x":1e999')],
    ['text coordinate', mutated((o) => (o.circuit.comps[0].x = 'NaN'))],
    ['coordinate beyond the limit', mutated((o) => (o.circuit.comps[0].y = 1e9))],
    ['wire from a missing component', mutated((o) => (o.circuit.wires[0].from.c = 99))],
    ['wire to a missing component', mutated((o) => (o.circuit.wires[0].to.c = 99))],
    ['unsupported component type', mutated((o) => (o.circuit.comps[2].type = 'BOGUS'))],
    ['prototype property as type', mutated((o) => (o.circuit.comps[2].type = 'toString'))],
    ['wire leaving an LED output', mutated((o) => (o.circuit.wires[0].from = { c: 4, p: 0 }))],
    ['wire entering a switch input', mutated((o) => (o.circuit.wires[0].to = { c: 1, p: 0 }))],
    ['wire from a component to itself', mutated((o) => (o.circuit.wires[0] = { id: 5, from: { c: 3, p: 0 }, to: { c: 3, p: 0 } }))],
    ['two drivers on one input', mutated((o) => (o.circuit.wires[1].to = o.circuit.wires[0].to))],
    ['state value of 2', mutated((o) => (o.circuit.comps[0].val = 2))],
    ['state value as text', mutated((o) => (o.circuit.comps[0].val = '1'))],
    ['boolean state flag', mutated((o) => (o.circuit.comps[0].q = true))],
    ['non-text name', mutated((o) => (o.circuit.comps[0].name = 5))],
    ['overlong name', mutated((o) => (o.circuit.comps[0].name = 'x'.repeat(65)))],
    ['fractional nid', mutated((o) => (o.circuit.nid = 8.5))],
    ['missing nid', mutated((o) => delete o.circuit.nid)],
    ['nid not above used ids', mutated((o) => (o.circuit.nid = 3))],
    ['unsupported version', mutated((o) => (o.version = 2))],
    ['invalid view', mutated((o) => (o.view.k = -1))],
    ['null view', mutated((o) => (o.view = null))],
    ['wire list not an array', mutated((o) => (o.circuit.wires = {}))],
    ['malformed JSON', '{"circuit":'],
    ['empty text', ''],
    ['array at top level', '[]'],
    ['oversized file', ' '.repeat(2_100_000)],
  ];
  for (const [name, text] of rejected) {
    it(`rejects ${name}`, () => {
      expect(parseCircuitFile(text).ok).toBe(false);
    });
  }
  it('rejects more components than the limit', () => {
    const o = base();
    o.circuit.comps = Array.from({ length: MAX_COMPONENTS + 1 }, (_, i) => ({ id: i + 1, type: 'SW', x: 0, y: 0, name: '', val: 0 }));
    o.circuit.wires = [];
    o.circuit.nid = MAX_COMPONENTS + 2;
    expect(parseCircuitFile(JSON.stringify(o)).ok).toBe(false);
  });
  it('gives a readable reason', () => {
    const r = parseCircuitFile(mutated((o) => (o.circuit.wires[0].to.p = 5)));
    expect(!r.ok && r.error).toMatch(/input pin/);
  });
  it('accepts the current format and reports older files as migrated', () => {
    const current = parseCircuitFile(JSON.stringify(base()));
    expect(current.ok && current.migrated).toBe(false);
    const legacy = base();
    delete legacy.version;
    const old = parseCircuitFile(JSON.stringify(legacy));
    expect(old.ok && old.migrated).toBe(true);
  });
  it('round-trips ids, wires, positions, names and sequential state', () => {
    const ex = buildExample('D flip-flop');
    const [d, clk] = ex.comps;
    const live = settle({ ...ex, comps: ex.comps.map((c) => (c.id === d.id || c.id === clk.id ? { ...c, val: 1 } : c)) }).circuit;
    expect(live.comps.find((c) => c.type === 'DFF')!.q).toBe(1);
    const r = parseCircuitFile(serializeCircuit(live, view));
    expect(r.ok && r.circuit).toEqual(live);
  });
});

describe('pointer interaction', () => {
  const ex = buildExample('D flip-flop');
  const sw = ex.comps[0];
  const clk = ex.comps[1];
  const dff = ex.comps[2];

  it('a plain click on a switch toggles it and is one undoable change', () => {
    const p = press(ex, NO_SELECTION, { k: 'comp', id: sw.id }, false, world);
    expect(p.sel.comps).toEqual([sw.id]);
    const r = release(ex, p.drag as never, false)!;
    expect(r.next.comps[0].val).toBe(1);
    expect(r.before).toBe(ex);
  });
  it('a plain click on the clock toggles its level', () => {
    const p = press(ex, NO_SELECTION, { k: 'comp', id: clk.id }, false, world);
    expect(release(ex, p.drag as never, false)!.next.comps[1].val).toBe(1);
  });
  it('Shift-click selects without toggling or starting a drag', () => {
    for (const id of [sw.id, clk.id]) {
      const p = press(ex, NO_SELECTION, { k: 'comp', id }, true, world);
      expect(p.drag).toBeNull();
      expect(p.sel.comps).toEqual([id]);
      expect(p.circuit).toBe(ex);
    }
  });
  it('Shift-click on a selected item removes it from the selection', () => {
    const p = press(ex, { comps: [sw.id, clk.id], wires: [] }, { k: 'comp', id: sw.id }, true, world);
    expect(p.sel.comps).toEqual([clk.id]);
  });
  it('dragging moves the component and never toggles it', () => {
    const p = press(ex, NO_SELECTION, { k: 'comp', id: sw.id }, false, world);
    const drag = p.drag as Extract<NonNullable<typeof p.drag>, { t: 'move' }>;
    const moved = moveSelection(ex, drag, { x: 33, y: 18 });
    expect(moved.comps[0]).toMatchObject({ x: sw.x + 30, y: sw.y + 20, val: 0 });
    const r = release(moved, drag, true)!;
    expect(r.before).toBe(ex);
    expect(r.next.comps[0].val).toBe(0);
  });
  it('dragging a selected component moves the whole selection and never toggles', () => {
    const sel = { comps: [sw.id, clk.id], wires: [] };
    const p = press(ex, sel, { k: 'comp', id: sw.id }, false, world);
    const drag = p.drag as Extract<NonNullable<typeof p.drag>, { t: 'move' }>;
    expect(p.sel).toBe(sel);
    expect(drag.origins).toHaveLength(2);
    const moved = moveSelection(ex, drag, { x: 10, y: 0 });
    expect(moved.comps[0].x).toBe(sw.x + 10);
    expect(moved.comps[1].x).toBe(clk.x + 10);
    expect(moved.comps[2].x).toBe(dff.x);
    expect(release(ex, drag, false)).toBeNull();
  });
  it('clicking a wire selects it and starts nothing else', () => {
    const p = press(ex, NO_SELECTION, { k: 'wire', id: ex.wires[0].id }, false, world);
    expect(p.drag).toBeNull();
    expect(p.sel).toEqual({ comps: [], wires: [ex.wires[0].id] });
    expect(p.circuit).toBe(ex);
  });
  it('clicking empty canvas clears the selection unless Shift is held', () => {
    const sel = { comps: [sw.id], wires: [] };
    expect(press(ex, sel, { k: 'empty' }, false, world).sel).toEqual(NO_SELECTION);
    expect(press(ex, sel, { k: 'empty' }, true, world).sel).toBe(sel);
  });
  it('a wire drag between valid pins creates one wire', () => {
    const { circ, ids: [s, and] } = build([['SW'], ['AND']]);
    const p = press(circ, NO_SELECTION, { k: 'pin', pin: { c: s, k: 'o', p: 0 } }, false, world);
    const r = finishWire(p.circuit, p.drag as never, { c: and, k: 'i', p: 0 });
    expect(r.error).toBeUndefined();
    expect(r.next.wires).toHaveLength(1);
    expect(r.before).toBe(circ);
  });
  it('an invalid drop reports why and cancels the gesture', () => {
    const { circ, ids: [s, and] } = build([['SW'], ['AND']]);
    const p = press(circ, NO_SELECTION, { k: 'pin', pin: { c: s, k: 'o', p: 0 } }, false, world);
    const r = finishWire(p.circuit, p.drag as never, { c: and, k: 'o', p: 0 });
    expect(r.error).toMatch(/Output → Output/);
    expect(r.next).toBe(circ);
  });
  it('dragging a wire off an input unplugs it; dropping on nothing keeps it unplugged', () => {
    const p = press(ex, NO_SELECTION, { k: 'pin', pin: { c: dff.id, k: 'i', p: 0 } }, false, world);
    expect(p.circuit.wires).toHaveLength(ex.wires.length - 1);
    expect(p.drag).toMatchObject({ t: 'wire', from: { c: sw.id, k: 'o', p: 0 }, start: ex });
    const r = finishWire(p.circuit, p.drag as never, null);
    expect(r.next.wires).toHaveLength(ex.wires.length - 1);
    expect(r.before).toBe(ex);
  });
  it('dropping the unplugged wire back on its own pin is a no-op', () => {
    const p = press(ex, NO_SELECTION, { k: 'pin', pin: { c: dff.id, k: 'i', p: 0 } }, false, world);
    const r = finishWire(p.circuit, p.drag as never, { c: dff.id, k: 'i', p: 0 });
    expect(commit(newEditor(ex), r.next, r.before)).toMatchObject({ ok: true, editor: { history: { past: [] } } });
  });
  it('keeps the pre-gesture circuit in drag.start so Escape or pointer-cancel can restore it', () => {
    const p = press(ex, NO_SELECTION, { k: 'pin', pin: { c: dff.id, k: 'i', p: 0 } }, false, world);
    expect(p.drag!.start).toBe(ex);
    expect(validateCircuit(p.drag!.start)).toEqual([]);
  });
});

describe('edit history', () => {
  const run = (ed: Editor, next: Circuit, before?: Circuit) => {
    const r = commit(ed, next, before);
    if (!r.ok) throw new Error(r.error);
    return r.editor;
  };

  it('undoes and redoes a multi-step session and drops the redo branch on a new edit', () => {
    let ed = newEditor(EMPTY);
    ed = run(ed, addComp(ed.circuit, 'SW', 0, 0));
    ed = run(ed, addComp(ed.circuit, 'AND', 100, 0));
    ed = run(ed, connect(ed.circuit, { c: 1, p: 0 }, { c: 2, p: 0 }));
    const wired = ed.circuit;
    expect(ed.history.past).toHaveLength(3);

    ed = step(ed, 'undo')!;
    expect(ed.circuit.wires).toHaveLength(0);
    ed = step(ed, 'redo')!;
    expect(ed.circuit).toEqual(wired);

    ed = step(step(ed, 'undo')!, 'undo')!;
    expect(ed.circuit.comps).toHaveLength(1);
    ed = run(ed, addComp(ed.circuit, 'OR', 0, 50));
    expect(ed.history.future).toHaveLength(0);
    expect(step(ed, 'redo')).toBeNull();
  });
  it('component deletion with several wires is one atomic step that undo fully restores', () => {
    const ex = buildExample('Full adder');
    const fa = ex.comps.find((c) => c.type === 'FA')!;
    const attached = ex.wires.filter((w) => w.from.c === fa.id || w.to.c === fa.id).length;
    expect(attached).toBe(5);
    let ed = newEditor(ex);
    ed = run(ed, removeItems(ed.circuit, { comps: [fa.id], wires: [] }));
    expect(ed.history.past).toHaveLength(1);
    expect(ed.circuit.wires).toHaveLength(ex.wires.length - attached);
    expect(validateCircuit(ed.circuit)).toEqual([]);
    ed = step(ed, 'undo')!;
    expect(ed.circuit).toEqual(ex);
    ed = step(ed, 'redo')!;
    expect(ed.circuit.comps.some((c) => c.id === fa.id)).toBe(false);
  });
  it('multi-selection deletion is one history entry', () => {
    const ex = buildExample('Half adder');
    const ed = run(newEditor(ex), removeItems(ex, { comps: [ex.comps[0].id, ex.comps[1].id], wires: [ex.wires[3].id] }));
    expect(ed.history.past).toHaveLength(1);
    expect(ed.circuit.comps).toHaveLength(3);
  });
  it('an edit that changes nothing adds no history entry', () => {
    const ex = buildExample('AND gate');
    const same = run(newEditor(ex), ex);
    expect(same.history.past).toHaveLength(0);
    const moved = moveSelection(ex, { t: 'move', start: ex, anchor: world, origins: [], activate: null }, { x: 5, y: 5 });
    expect(run(newEditor(ex), moved).history.past).toHaveLength(0);
    expect(run(newEditor(ex), removeItems(ex, NO_SELECTION)).history.past).toHaveLength(0);
  });
  it('a completed drag is a single entry however many previews preceded it', () => {
    const ex = buildExample('AND gate');
    const p = press(ex, NO_SELECTION, { k: 'comp', id: ex.comps[2].id }, false, world);
    const d = p.drag as Extract<NonNullable<typeof p.drag>, { t: 'move' }>;
    let live = ex;
    for (let i = 1; i <= 25; i++) live = moveSelection(live, d, { x: i * 10, y: 0 });
    const r = release(live, d, true)!;
    const ed = run(newEditor(ex), r.next, r.before);
    expect(ed.history.past).toEqual([ex]);
    expect(ed.circuit.comps[2].x).toBe(ex.comps[2].x + 250);
  });
  it('switch toggles and Clear All are undoable', () => {
    const ex = buildExample('AND gate');
    const p = press(ex, NO_SELECTION, { k: 'comp', id: ex.comps[0].id }, false, world);
    const r = release(ex, p.drag as never, false)!;
    let ed = run(newEditor(ex), r.next, r.before);
    expect(ed.circuit.comps[0].val).toBe(1);
    ed = step(ed, 'undo')!;
    expect(ed.circuit.comps[0].val).toBe(0);
    ed = run(ed, { ...EMPTY, nid: ed.circuit.nid });
    expect(ed.circuit.comps).toHaveLength(0);
    expect(step(ed, 'undo')!.circuit).toEqual(ex);
  });
  it('rejects an edit that would leave dangling references, leaving state untouched', () => {
    const ex = buildExample('AND gate');
    const broken = { ...ex, comps: ex.comps.slice(1) };
    const r = commit(newEditor(ex), broken);
    expect(r.ok).toBe(false);
  });
  it('limits history size', () => {
    let ed = newEditor(EMPTY);
    for (let i = 0; i < 130; i++) ed = run(ed, addComp(ed.circuit, 'SW', i, 0));
    expect(ed.history.past).toHaveLength(100);
    expect(ed.circuit.comps).toHaveLength(130);
  });
  it('never mutates earlier snapshots', () => {
    let ed = newEditor(deepFreeze(buildExample('Full adder')));
    const fa = ed.circuit.comps.find((c) => c.type === 'FA')!;
    ed = run(ed, deepFreeze(removeItems(ed.circuit, { comps: [fa.id], wires: [] })));
    ed = run(ed, deepFreeze(addComp(ed.circuit, 'XOR', 0, 0)));
    ed = deepFreeze(step(ed, 'undo')!);
    ed = deepFreeze(step(ed, 'undo')!);
    expect(ed.circuit.comps.some((c) => c.id === fa.id)).toBe(true);
    expect(truthTable(ed.circuit).ok).toBe(true);
  });
});

describe('stale state after deletion', () => {
  it('recomputes outputs instead of keeping values from deleted drivers', () => {
    const ex = buildExample('AND gate');
    const high = settle({ ...ex, comps: ex.comps.map((c) => (c.type === 'SW' ? { ...c, val: 1 } : c)) }).circuit;
    expect(high.comps.find((c) => c.type === 'AND')!.out).toEqual([1]);
    const after = settle(removeItems(high, { comps: [high.comps[0].id], wires: [] })).circuit;
    expect(after.comps.find((c) => c.type === 'AND')!.out).toEqual([0]);
    expect(validateCircuit(after)).toEqual([]);
  });
});

describe('truth table reliability', () => {
  it('matches an independently computed 2:1 multiplexer', () => {
    let { circ, ids: [d0, d1, s, mux, led] } = build([['SW', 'D0'], ['SW', 'D1'], ['SW', 'S'], ['MUX2'], ['LED', 'Y']]);
    circ = connect(circ, { c: d0, p: 0 }, { c: mux, p: 0 });
    circ = connect(circ, { c: d1, p: 0 }, { c: mux, p: 1 });
    circ = connect(circ, { c: s, p: 0 }, { c: mux, p: 2 });
    circ = connect(circ, { c: mux, p: 0 }, { c: led, p: 0 });
    const t = truthTable(circ);
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.inputs).toEqual(['D0', 'D1', 'S']);
    expect(t.rows).toHaveLength(8);
    for (const r of t.rows) expect(r.out).toEqual([r.in[2] ? r.in[1] : r.in[0]]);
  });
  it('half adder rows follow the arithmetic', () => {
    const t = truthTable(buildExample('Half adder'));
    expect(t.ok && t.rows.map((r) => [...r.in, ...r.out])).toEqual([[0, 0, 0, 0], [0, 1, 1, 0], [1, 0, 1, 0], [1, 1, 0, 1]]);
  });
  it('treats disconnected inputs as 0 and says so through consistent output', () => {
    let { circ, ids: [a, and, led] } = build([['SW', 'A'], ['AND'], ['LED', 'Y']]);
    circ = connect(circ, { c: a, p: 0 }, { c: and, p: 0 });
    circ = connect(circ, { c: and, p: 0 }, { c: led, p: 0 });
    const t = truthTable(circ);
    expect(t.ok && t.rows.map((r) => r.out[0])).toEqual([0, 0]);
  });
  it('reports a circuit with no inputs and does not enumerate past the limit', () => {
    expect(truthTable(build([['LED']]).circ).ok).toBe(false);
    expect(truthTable(build([...Array.from({ length: 11 }, () => ['SW'] as [TypeId]), ['LED']]).circ).ok).toBe(false);
  });
  it('is deterministic', () => {
    const c = buildExample('Full adder');
    expect(truthTable(c)).toEqual(truthTable(c));
  });
});

describe('keyboard targets', () => {
  it('treats form fields and editable content as typing', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) expect(isTyping({ tagName })).toBe(true);
    expect(isTyping({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isTyping({ tagName: 'svg' })).toBe(false);
    expect(isTyping(null)).toBe(false);
  });
  it('treats buttons as controls so canvas shortcuts leave them alone', () => {
    expect(isControl({ tagName: 'BUTTON' })).toBe(true);
    expect(isControl({ tagName: 'svg' })).toBe(false);
  });
});
