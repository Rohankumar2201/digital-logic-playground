import type { Circuit, Comp, PinRef, TypeId } from '../types';
import { defs } from './components';

export const inVals = (circ: Circuit, c: Comp): number[] =>
  defs[c.type].in.map((_, p) => {
    const w = circ.wires.find((w) => w.to.c === c.id && w.to.p === p);
    return w ? circ.comps.find((x) => x.id === w.from.c)!.out[w.from.p] : 0;
  });

// Combinational logic is relaxed until outputs stop changing. Flip-flops then sample
// their inputs together on a rising clock edge, so chained flip-flops see pre-edge values.
export function settle(circ: Circuit): { circuit: Circuit; stable: boolean } {
  const cur: Circuit = { ...circ, comps: circ.comps.map((c) => ({ ...c, out: [...c.out] })) };
  let stable = true;
  for (let round = 0; round < 10; round++) {
    let changed = true;
    let n = 0;
    while (changed && n++ < 60) {
      changed = false;
      for (const c of cur.comps) {
        const o = defs[c.type].eval(inVals(cur, c), c);
        if (o.join() !== c.out.join()) {
          c.out = o;
          changed = true;
        }
      }
    }
    if (changed) stable = false;
    let flipped = false;
    for (const c of cur.comps) {
      const d = defs[c.type];
      if (!d.ff) continue;
      const i = inVals(cur, c);
      const clk = i[i.length - 1];
      if (clk && !c.prev) {
        const q = d.next!(i, c.q);
        if (q !== c.q) {
          c.q = q;
          flipped = true;
        }
      }
      c.prev = clk;
    }
    if (!flipped) break;
  }
  return { circuit: cur, stable };
}

export function addComp(circ: Circuit, type: TypeId, x: number, y: number, name?: string): Circuit {
  const n = circ.comps.filter((c) => c.type === type).length;
  const auto = type === 'SW' ? String.fromCharCode(65 + (n % 26)) : type === 'LED' ? 'Y' + n : type === 'CLK' ? 'CLK' : '';
  const comp: Comp = {
    id: circ.nid, type, x, y, name: name ?? auto,
    val: 0, q: 0, prev: 0, run: 0, out: defs[type].out.map(() => 0),
  };
  return { ...circ, nid: circ.nid + 1, comps: [...circ.comps, comp] };
}

export function canConnect(circ: Circuit, a: PinRef, b: PinRef): [boolean, string] {
  if (a.k === b.k) return [false, a.k === 'o' ? 'Output → Output is not allowed' : 'Input → Input is not allowed'];
  if (a.c === b.c) return [false, 'A component cannot drive itself'];
  const i = a.k === 'i' ? a : b;
  if (circ.wires.some((w) => w.to.c === i.c && w.to.p === i.p)) return [false, 'That input is already driven'];
  return [true, ''];
}
