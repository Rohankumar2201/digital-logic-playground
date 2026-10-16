export type TypeId =
  | 'SW' | 'CLK' | 'LED'
  | 'AND' | 'OR' | 'NOT' | 'NAND' | 'NOR' | 'XOR' | 'XNOR'
  | 'DFF' | 'JKFF' | 'TFF'
  | 'MUX2' | 'MUX4' | 'DEMUX' | 'DEC' | 'ENC' | 'HA' | 'FA';

export interface Comp {
  id: number;
  type: TypeId;
  x: number;
  y: number;
  name: string;
  val: number;
  q: number;
  prev: number;
  run: number;
  out: number[];
}

export interface Wire {
  id: number;
  from: { c: number; p: number };
  to: { c: number; p: number };
}

export interface Circuit {
  comps: Comp[];
  wires: Wire[];
  nid: number;
}

export interface PinRef {
  c: number;
  k: 'i' | 'o';
  p: number;
}

export interface View {
  x: number;
  y: number;
  k: number;
}

export interface Selection {
  comps: number[];
  wires: number[];
}

export const NO_SELECTION: Selection = { comps: [], wires: [] };
