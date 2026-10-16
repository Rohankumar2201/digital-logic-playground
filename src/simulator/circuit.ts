import type { Circuit, Comp, PinRef, Selection, TypeId, View } from '../types';
import { defs } from './components';
import { canConnect, inVals, settle } from './engine';

export const FILE_VERSION = 1;
export const TRUTH_TABLE_MAX_INPUTS = 10;

export function removeItems(circ: Circuit, sel: Selection): Circuit {
  const comps = new Set(sel.comps);
  const wires = new Set(sel.wires);
  return {
    ...circ,
    comps: circ.comps.filter((c) => !comps.has(c.id)),
    wires: circ.wires.filter((w) => !wires.has(w.id) && !comps.has(w.from.c) && !comps.has(w.to.c)),
  };
}

export function connect(circ: Circuit, from: { c: number; p: number }, to: { c: number; p: number }): Circuit {
  const src = circ.comps.find((c) => c.id === from.c);
  const dst = circ.comps.find((c) => c.id === to.c);
  if (!src || !dst) throw new Error('Wire endpoint does not exist');
  if (from.p >= defs[src.type].out.length) throw new Error(`${defs[src.type].title} has no output pin ${from.p}`);
  if (to.p >= defs[dst.type].in.length) throw new Error(`${defs[dst.type].title} has no input pin ${to.p}`);
  const a: PinRef = { ...from, k: 'o' };
  const b: PinRef = { ...to, k: 'i' };
  const [ok, why] = canConnect(circ, a, b);
  if (!ok) throw new Error(why);
  return { ...circ, nid: circ.nid + 1, wires: [...circ.wires, { id: circ.nid, from, to }] };
}

export const MAX_FILE_CHARS = 2_000_000;
export const MAX_COMPONENTS = 2000;
export const MAX_WIRES = 5000;
const COORD_LIMIT = 1_000_000;

const isId = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1;
const isPin = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

export function circuitsEqual(a: Circuit, b: Circuit): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function validateCircuit(circ: Circuit): string[] {
  const errors: string[] = [];
  if (circ.comps.length > MAX_COMPONENTS) errors.push(`Too many components (limit ${MAX_COMPONENTS})`);
  if (circ.wires.length > MAX_WIRES) errors.push(`Too many wires (limit ${MAX_WIRES})`);
  const ids = new Set<number>();
  for (const c of circ.comps) {
    if (!isId(c.id)) errors.push(`Component id ${String(c.id)} must be a positive integer`);
    if (ids.has(c.id)) errors.push(`Duplicate component id ${c.id}`);
    ids.add(c.id);
    if (!Object.prototype.hasOwnProperty.call(defs, c.type)) errors.push(`Component ${c.id} has unsupported type`);
    if (![c.x, c.y].every((n) => Number.isFinite(n) && Math.abs(n) <= COORD_LIMIT)) errors.push(`Component ${c.id} has an invalid position`);
  }
  const wireIds = new Set<number>();
  const driven = new Set<string>();
  for (const w of circ.wires) {
    if (!isId(w.id)) errors.push(`Wire id ${String(w.id)} must be a positive integer`);
    if (wireIds.has(w.id)) errors.push(`Duplicate wire id ${w.id}`);
    wireIds.add(w.id);
    if (!isId(w.from.c) || !isId(w.to.c) || !isPin(w.from.p) || !isPin(w.to.p)) {
      errors.push(`Wire ${w.id} has a non-integer component or pin index`);
      continue;
    }
    const src = circ.comps.find((c) => c.id === w.from.c);
    const dst = circ.comps.find((c) => c.id === w.to.c);
    if (!src || !dst) {
      errors.push(`Wire ${w.id} references a missing component`);
      continue;
    }
    if (src.id === dst.id) errors.push(`Wire ${w.id} connects a component to itself`);
    if (!defs[src.type]) continue;
    if (!defs[dst.type]) continue;
    if (w.from.p >= defs[src.type].out.length) errors.push(`Wire ${w.id} starts at an output pin that ${src.type} does not have`);
    if (w.to.p >= defs[dst.type].in.length) errors.push(`Wire ${w.id} ends at an input pin that ${dst.type} does not have`);
    const key = `${w.to.c}.${w.to.p}`;
    if (driven.has(key)) errors.push(`Input ${key} has more than one driver`);
    driven.add(key);
  }
  return errors;
}

export const serializeCircuit = (circuit: Circuit, view: View) =>
  JSON.stringify({ version: FILE_VERSION, circuit, view }, null, 1);

export type ParseResult =
  | { ok: true; circuit: Circuit; view?: View; migrated: boolean }
  | { ok: false; error: string };

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const fail = (error: string): ParseResult => ({ ok: false, error });
const isBit = (v: unknown): v is 0 | 1 => v === 0 || v === 1;

// Files written before versioning have no "version" field and use the version 1 layout, so
// they are accepted and reported as migrated. Nothing malformed is coerced or dropped.
export function parseCircuitFile(text: string): ParseResult {
  if (text.length > MAX_FILE_CHARS) return fail('File is too large to be a circuit');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail('File is not valid JSON');
  }
  if (!isObj(raw) || !isObj(raw.circuit)) return fail('File does not contain a circuit');
  if (raw.version !== undefined && raw.version !== FILE_VERSION) return fail(`Unsupported file version ${String(raw.version)}`);
  const { comps: rawComps, wires: rawWires, nid } = raw.circuit;
  if (!Array.isArray(rawComps) || !Array.isArray(rawWires)) return fail('Circuit is missing its component or wire list');
  if (rawComps.length > MAX_COMPONENTS || rawWires.length > MAX_WIRES) return fail('Circuit is too large');
  if (!isId(nid)) return fail('Circuit id counter (nid) must be a positive integer');

  const comps: Comp[] = [];
  for (const r of rawComps) {
    if (!isObj(r) || typeof r.type !== 'string' || !Object.prototype.hasOwnProperty.call(defs, r.type)) return fail('Unsupported component type');
    if (!isNum(r.id) || !isNum(r.x) || !isNum(r.y)) return fail(`Component ${String(r.id)} has a non-numeric id or position`);
    if (r.name !== undefined && typeof r.name !== 'string') return fail(`Component ${r.id} has a non-text name`);
    if ((r.name as string | undefined ?? '').length > 64) return fail(`Component ${r.id} has a name longer than 64 characters`);
    const flags = [r.val, r.q ?? 0, r.prev ?? 0, r.run ?? 0];
    if (!flags.every(isBit)) return fail(`Component ${r.id} has a state value that is not 0 or 1`);
    const type = r.type as TypeId;
    comps.push({
      id: r.id, type, x: r.x, y: r.y, name: (r.name as string | undefined) ?? '',
      val: flags[0] as number, q: flags[1] as number, prev: flags[2] as number, run: flags[3] as number,
      out: defs[type].out.map(() => 0),
    });
  }
  const wires: Circuit['wires'] = [];
  for (const r of rawWires) {
    const from = isObj(r) ? r.from : null;
    const to = isObj(r) ? r.to : null;
    if (!isObj(r) || !isObj(from) || !isObj(to) || !isNum(r.id) || !isNum(from.c) || !isNum(from.p) || !isNum(to.c) || !isNum(to.p)) {
      return fail('Wire has an invalid shape');
    }
    wires.push({ id: r.id, from: { c: from.c, p: from.p }, to: { c: to.c, p: to.p } });
  }
  const circuit: Circuit = { comps, wires, nid };
  const errors = validateCircuit(circuit);
  if (errors.length) return fail(errors[0]);
  if (nid <= Math.max(0, ...comps.map((c) => c.id), ...wires.map((w) => w.id))) return fail('Circuit id counter (nid) is not larger than every id in use');

  let view: View | undefined;
  if (raw.view !== undefined) {
    const v = raw.view;
    if (!isObj(v) || !isNum(v.x) || !isNum(v.y) || !isNum(v.k) || v.k < 0.1 || v.k > 10) return fail('Saved view is invalid');
    view = { x: v.x, y: v.y, k: v.k };
  }
  return { ok: true, circuit: settle(circuit).circuit, view, migrated: raw.version === undefined };
}

export type TruthTable =
  | { ok: true; inputs: string[]; outputs: string[]; rows: { in: number[]; out: number[] }[] }
  | { ok: false; error: string };

function labels(comps: Comp[]): string[] {
  const base = comps.map((c) => c.name || `${c.type}${c.id}`);
  return base.map((n, i) => (base.indexOf(n) === i && base.lastIndexOf(n) === i ? n : `${n}#${comps[i].id}`));
}

// Every switch is an input and every LED an output; unconnected pins read as 0.
export function truthTable(circ: Circuit): TruthTable {
  if (circ.comps.some((c) => defs[c.type].ff || c.type === 'CLK')) {
    return { ok: false, error: 'This circuit has clocked state. A static truth table does not describe time-dependent behavior; use the live simulation instead.' };
  }
  const switches = circ.comps.filter((c) => c.type === 'SW');
  const leds = circ.comps.filter((c) => c.type === 'LED');
  if (!switches.length || !leds.length) return { ok: false, error: 'Add at least one switch and one LED to generate a truth table.' };
  if (switches.length > TRUTH_TABLE_MAX_INPUTS) return { ok: false, error: `Too many inputs (${switches.length}). The limit is ${TRUTH_TABLE_MAX_INPUTS}.` };

  const n = switches.length;
  const rows: { in: number[]; out: number[] }[] = [];
  for (let r = 0; r < 1 << n; r++) {
    const bits = switches.map((_, k) => (r >> (n - 1 - k)) & 1);
    const comps = circ.comps.map((c) => {
      const k = switches.findIndex((s) => s.id === c.id);
      return k >= 0 ? { ...c, val: bits[k] } : c;
    });
    const result = settle({ ...circ, comps });
    if (!result.stable) return { ok: false, error: 'The circuit does not settle for every input combination (feedback oscillation).' };
    const out = leds.map((l) => inVals(result.circuit, result.circuit.comps.find((c) => c.id === l.id)!)[0]);
    rows.push({ in: bits, out });
  }
  return { ok: true, inputs: labels(switches), outputs: labels(leds), rows };
}

export function truthTableCsv(t: Extract<TruthTable, { ok: true }>): string {
  const cell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [[...t.inputs, ...t.outputs].map(cell).join(','), ...t.rows.map((r) => [...r.in, ...r.out].join(','))].join('\n') + '\n';
}
