import { defs } from '../simulator/components';
import { inVals } from '../simulator/engine';
import type { Circuit, Comp, Selection } from '../types';

interface Props {
  circuit: Circuit;
  sel: Selection;
  onRename: (id: number, name: string) => void;
  onRenameEnd: () => void;
  onToggleRun: (id: number) => void;
  onDelete: () => void;
}

export default function InfoPanel({ circuit, sel, onRename, onRenameEnd, onToggleRun, onDelete }: Props) {
  const count = sel.comps.length + sel.wires.length;
  const comp = sel.comps.length === 1 && !sel.wires.length ? circuit.comps.find((c) => c.id === sel.comps[0]) : undefined;
  return (
    <aside className="w-56 shrink-0 overflow-auto border-l border-[var(--bd)] bg-[var(--pn)] p-2">
      {comp ? <CompInfo circuit={circuit} comp={comp} {...{ onRename, onRenameEnd, onToggleRun, onDelete }} /> : count ? (
        <>
          <h3 className="mono mb-1.5 text-xs font-semibold">{count} SELECTED</h3>
          <p className="mb-2 text-[var(--mu)]">{sel.comps.length} component(s), {sel.wires.length} wire(s). Shift-click to add or remove items.</p>
          <button className="btn" onClick={onDelete}>Delete selected</button>
        </>
      ) : (
        <>
          <h3 className="mono mb-1.5 text-xs font-semibold">NO SELECTION</h3>
          <p className="text-[var(--mu)]">
            Drag a part onto the canvas, or click it in the list. Drag from an output pin to an input pin to wire them
            (Esc cancels). Click a switch to toggle it. Shift-click selects several items; Ctrl+A selects all. Drag a wire
            off an input pin to unplug it. Drag the background (or hold Space) to pan, scroll to zoom.
          </p>
        </>
      )}
    </aside>
  );
}

function CompInfo({ circuit, comp, onRename, onRenameEnd, onToggleRun, onDelete }: Omit<Props, 'sel'> & { comp: Comp }) {
  const d = defs[comp.type];
  const iv = inVals(circuit, comp);
  const n = d.in.length;
  const cur = iv.reduce((a, b) => a * 2 + b, 0);
  return (
    <>
      <h3 className="mono mb-1.5 text-xs font-semibold">{d.title.toUpperCase()}</h3>
      {(comp.type === 'SW' || comp.type === 'LED') && (
        <input className="field mb-2 w-24" value={comp.name} maxLength={64}
          onChange={(e) => onRename(comp.id, e.target.value)} onBlur={onRenameEnd}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
      )}
      <div className="mono">
        {d.in.map((name, p) => <div key={name + p}>{name} = {iv[p]}</div>)}
        {d.out.length > 0 && <br />}
        {d.out.map((name, p) => <div key={name + p}>{name} = {comp.out[p]}</div>)}
      </div>
      {comp.type === 'CLK' && (
        <p className="mt-2">
          Level: {comp.val ? 'HIGH' : 'LOW'} (click the block to pulse)
          <br />
          <button className="btn mt-1" onClick={() => onToggleRun(comp.id)}>{comp.run ? 'Stop' : 'Run'} (1 Hz)</button>
        </p>
      )}
      {!d.io && !d.ff && (
        <table className="tt">
          <thead>
            <tr>{[...d.in, ...d.out].map((h) => <th key={h}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {Array.from({ length: 1 << n }, (_, r) => {
              const i = d.in.map((_, k) => (r >> (n - 1 - k)) & 1);
              return (
                <tr key={r} className={r === cur ? 'cur' : ''}>
                  {[...i, ...d.eval(i, comp)].map((v, k) => <td key={k}>{v}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="mt-3"><button className="btn" onClick={onDelete}>Delete</button></p>
    </>
  );
}
