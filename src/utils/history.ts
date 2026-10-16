export interface History<T> {
  past: T[];
  future: T[];
}

export const emptyHistory = <T>(): History<T> => ({ past: [], future: [] });

export function record<T>(h: History<T>, current: T, limit = 100): History<T> {
  return { past: [...h.past, current].slice(-limit), future: [] };
}

export function undo<T>(h: History<T>, current: T): { history: History<T>; state: T } | null {
  if (!h.past.length) return null;
  return { history: { past: h.past.slice(0, -1), future: [...h.future, current] }, state: h.past[h.past.length - 1] };
}

export function redo<T>(h: History<T>, current: T): { history: History<T>; state: T } | null {
  if (!h.future.length) return null;
  return { history: { past: [...h.past, current], future: h.future.slice(0, -1) }, state: h.future[h.future.length - 1] };
}
