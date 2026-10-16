import type { Circuit } from '../types';
import { record, redo, undo } from '../utils/history';
import type { History } from '../utils/history';
import { circuitsEqual, validateCircuit } from './circuit';
import { settle } from './engine';

export interface Editor {
  circuit: Circuit;
  history: History<Circuit>;
}

export type Commit = { ok: true; editor: Editor; stable: boolean } | { ok: false; error: string };

export const newEditor = (circuit: Circuit): Editor => ({ circuit, history: { past: [], future: [] } });

// One call is one undoable edit. Edits that change nothing are not recorded, and an edit
// that would leave the circuit invalid is rejected before it reaches state or history.
export function commit(ed: Editor, next: Circuit, before: Circuit = ed.circuit): Commit {
  const errors = validateCircuit(next);
  if (errors.length) return { ok: false, error: errors[0] };
  const r = settle(next);
  const history = circuitsEqual(r.circuit, before) ? ed.history : record(ed.history, before);
  return { ok: true, stable: r.stable, editor: { circuit: r.circuit, history } };
}

export function step(ed: Editor, dir: 'undo' | 'redo'): Editor | null {
  const r = (dir === 'undo' ? undo : redo)(ed.history, ed.circuit);
  return r ? { circuit: r.state, history: r.history } : null;
}
