import { useEffect, useRef, useState } from 'react';
import Canvas from './components/Canvas';
import InfoPanel from './components/InfoPanel';
import Sidebar from './components/Sidebar';
import Toolbar from './components/Toolbar';
import TruthTablePanel from './components/TruthTable';
import { buildExample } from './circuits/examples';
import { parseCircuitFile, removeItems, serializeCircuit } from './simulator/circuit';
import { commit, newEditor, step } from './simulator/edit';
import type { Editor } from './simulator/edit';
import { addComp, settle } from './simulator/engine';
import { NO_SELECTION } from './types';
import type { Circuit, Selection, TypeId, View } from './types';
import { download } from './utils/files';
import { snap10 } from './utils/geometry';
import { isControl, isTyping } from './utils/keyboard';
import { isEmpty } from './utils/selection';

const KEY = 'dlp.circuit';
const EMPTY: Circuit = { comps: [], wires: [], nid: 1 };
const DEFAULT_VIEW: View = { x: 40, y: 20, k: 1 };

/*
 * History policy: every user edit to the circuit is one undo step (add, move, delete, wire,
 * rename, switch or manual clock toggle, Reset, Clear All, load/import/example). Automatic clock
 * ticks and the clock Run/Stop button are simulation state and are never recorded. Each snapshot
 * includes the settled simulation state, so undo restores outputs and flip-flops consistently.
 */
export default function App() {
  const [ed, setEd] = useState<Editor>(() => newEditor(buildExample('AND gate')));
  const [sel, setSel] = useState<Selection>(NO_SELECTION);
  const [view, setView] = useState<View>(DEFAULT_VIEW);
  const [message, setMessage] = useState('');
  const [showTable, setShowTable] = useState(false);
  const [dark, setDark] = useState(() => {
    const t = localStorage.getItem('dlp.theme');
    return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  });
  const timer = useRef<number>();
  const renameBase = useRef<Circuit | null>(null);
  const { circuit, history } = ed;

  const flash = (m: string) => {
    setMessage(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(''), 3500);
  };

  const preview = (c: Circuit) => setEd((e) => ({ ...e, circuit: settle(c).circuit }));

  const commitEdit = (next: Circuit, before: Circuit = circuit): boolean => {
    const r = commit(ed, next, before);
    if (!r.ok) {
      flash(`Edit rejected: ${r.error}`);
      if (before !== circuit) preview(before);
      return false;
    }
    if (!r.stable) flash('Circuit is unstable (feedback oscillation)');
    setEd(r.editor);
    return true;
  };

  const travel = (dir: 'undo' | 'redo') => {
    const next = step(ed, dir);
    if (!next) return;
    setEd(next);
    setSel(NO_SELECTION);
  };

  const deleteSel = () => {
    if (isEmpty(sel)) return;
    commitEdit(removeItems(circuit, sel));
    setSel(NO_SELECTION);
  };

  const clearAll = () => {
    if (!circuit.comps.length && !circuit.wires.length) return;
    if (!window.confirm('Remove every component and wire? You can undo this.')) return;
    commitEdit({ ...EMPTY, nid: circuit.nid });
    setSel(NO_SELECTION);
  };

  const place = (t: TypeId, x: number, y: number) => {
    const next = addComp(circuit, t, snap10(x), snap10(y));
    if (commitEdit(next)) setSel({ comps: [next.nid - 1], wires: [] });
  };

  const addAtCenter = (t: TypeId) => {
    const n = (circuit.comps.length % 8) * 10;
    place(t, (window.innerWidth / 2 - view.x) / view.k - 120 + n, (window.innerHeight / 2 - view.y) / view.k - 60 + n);
  };

  const rename = (id: number, name: string) => {
    if (!renameBase.current) renameBase.current = circuit;
    setEd({ ...ed, circuit: { ...circuit, comps: circuit.comps.map((c) => (c.id === id ? { ...c, name } : c)) } });
  };

  const renameEnd = () => {
    const base = renameBase.current;
    renameBase.current = null;
    if (base) commitEdit(circuit, base);
  };

  const toggleRun = (id: number) =>
    setEd((e) => ({ ...e, circuit: { ...e.circuit, comps: e.circuit.comps.map((c) => (c.id === id ? { ...c, run: c.run ^ 1 } : c)) } }));

  const resetSim = () => {
    commitEdit({ ...circuit, comps: circuit.comps.map((c) => ({ ...c, val: 0, q: 0, prev: 0, run: 0 })) });
    flash('Simulation reset');
  };

  // The incoming circuit is validated before anything about the current one changes.
  const openText = (text: string, source: string) => {
    const r = parseCircuitFile(text);
    if (!r.ok) return flash(`Could not load ${source}: ${r.error}`);
    if (!commitEdit(r.circuit)) return;
    setView(r.view ?? DEFAULT_VIEW);
    setSel(NO_SELECTION);
    flash(r.migrated ? `Loaded ${source} (older file format)` : `Loaded ${source}`);
  };

  const save = () => {
    try {
      if (localStorage.getItem(KEY) && !window.confirm('Replace the circuit already saved in this browser?')) return;
      localStorage.setItem(KEY, serializeCircuit(circuit, view));
      flash('Saved');
    } catch {
      flash('Saving failed: browser storage is unavailable or full');
    }
  };

  const load = () => {
    let s: string | null;
    try {
      s = localStorage.getItem(KEY);
    } catch {
      return flash('Loading failed: browser storage is unavailable');
    }
    if (!s) return flash('Nothing saved yet');
    openText(s, 'saved circuit');
  };

  const loadExample = (name: string) => {
    if (!name) return;
    commitEdit(buildExample(name));
    setView(DEFAULT_VIEW);
    setSel(NO_SELECTION);
  };

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem('dlp.theme', dark ? 'dark' : 'light');
    } catch {
      /* theme just will not persist */
    }
  }, [dark]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setEd((e) =>
        e.circuit.comps.some((x) => x.type === 'CLK' && x.run)
          ? { ...e, circuit: settle({ ...e.circuit, comps: e.circuit.comps.map((x) => (x.type === 'CLK' && x.run ? { ...x, val: x.val ^ 1 } : x)) }).circuit }
          : e,
      );
    }, 500);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (isTyping(t)) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && (k === 'z' || k === 'y')) {
        e.preventDefault();
        travel(k === 'y' || e.shiftKey ? 'redo' : 'undo');
        return;
      }
      if (isControl(t)) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSel();
      } else if (e.key === 'Escape') setSel(NO_SELECTION);
      else if (mod && k === 'a') {
        e.preventDefault();
        setSel({ comps: circuit.comps.map((c) => c.id), wires: circuit.wires.map((w) => w.id) });
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  return (
    <div className="flex h-full flex-col">
      <Toolbar
        message={message}
        canDelete={!isEmpty(sel)}
        canUndo={history.past.length > 0}
        canRedo={history.future.length > 0}
        showTable={showTable}
        onClear={clearAll}
        onSave={save}
        onLoad={load}
        onExport={() => download('circuit.json', serializeCircuit(circuit, view), 'application/json')}
        onImport={(f) => f.text().then((t) => openText(t, f.name), () => flash('Could not read the file'))}
        onUndo={() => travel('undo')}
        onRedo={() => travel('redo')}
        onDelete={deleteSel}
        onReset={resetSim}
        onExample={loadExample}
        onTable={() => setShowTable(!showTable)}
        onTheme={() => setDark(!dark)}
      />
      <div className="flex min-h-0 flex-1">
        <Sidebar onAdd={addAtCenter} />
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <Canvas circuit={circuit} sel={sel} view={view} onSel={setSel} onView={setView} onPreview={preview}
              onCommit={commitEdit} onPlace={place} onMsg={flash} />
          </div>
          {showTable && (
            <div className="max-h-[40%] overflow-auto border-t border-[var(--bd)] bg-[var(--pn)]">
              <TruthTablePanel circuit={circuit} onMsg={flash} />
            </div>
          )}
        </main>
        <InfoPanel circuit={circuit} sel={sel} onRename={rename} onRenameEnd={renameEnd} onToggleRun={toggleRun} onDelete={deleteSel} />
      </div>
    </div>
  );
}
