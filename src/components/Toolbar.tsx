import { useRef } from 'react';
import { exampleNames } from '../circuits/examples';

interface Props {
  message: string;
  canDelete: boolean;
  canUndo: boolean;
  canRedo: boolean;
  showTable: boolean;
  onClear: () => void;
  onSave: () => void;
  onLoad: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onUndo: () => void;
  onRedo: () => void;
  onDelete: () => void;
  onReset: () => void;
  onExample: (name: string) => void;
  onTable: () => void;
  onTheme: () => void;
}

const Trash = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9h6.6L12 4M6.5 6.5v4.5M9.5 6.5v4.5" />
  </svg>
);

export default function Toolbar(p: Props) {
  const file = useRef<HTMLInputElement>(null);
  return (
    <header className="flex flex-wrap items-center gap-1.5 border-b border-[var(--bd)] bg-[var(--pn)] px-2.5 py-1.5">
      <b className="mono mr-2 text-[13px]">Digital Logic Playground</b>
      <button className="btn" onClick={p.onSave} title="Save to this browser">Save</button>
      <button className="btn" onClick={p.onLoad} title="Load the browser-saved circuit">Load</button>
      <button className="btn" onClick={p.onExport} title="Download circuit as a .json file">Export</button>
      <button className="btn" onClick={() => file.current?.click()} title="Open a circuit .json file">Import</button>
      <input ref={file} type="file" accept=".json,application/json" hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) p.onImport(f); e.target.value = ''; }} />
      <span className="mx-1 h-4 border-l border-[var(--bd)]" />
      <button className="btn" onClick={p.onUndo} disabled={!p.canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">Undo</button>
      <button className="btn" onClick={p.onRedo} disabled={!p.canRedo} title="Redo (Ctrl+Y)" aria-label="Redo">Redo</button>
      <button className="btn inline-flex items-center gap-1 hover:!border-[var(--bad)]" onClick={p.onDelete} disabled={!p.canDelete}
        title="Delete selected (Del)" aria-label="Delete selected"><Trash /> Delete</button>
      <button className="btn" onClick={p.onClear} title="Remove everything (can be undone)">Clear All</button>
      <button className="btn" onClick={p.onReset} title="Set switches, clocks and flip-flops back to 0">Reset</button>
      <span className="mx-1 h-4 border-l border-[var(--bd)]" />
      <select className="field" value="" aria-label="Load example" onChange={(e) => p.onExample(e.target.value)}>
        <option value="">Examples…</option>
        {exampleNames.map((n) => <option key={n}>{n}</option>)}
      </select>
      <button className="btn" onClick={p.onTable} aria-pressed={p.showTable}>Truth Table</button>
      <button className="btn" onClick={p.onTheme}>Dark / Light</button>
      <span className="ml-2 text-xs text-[var(--mu)]" role="status">{p.message}</span>
    </header>
  );
}
