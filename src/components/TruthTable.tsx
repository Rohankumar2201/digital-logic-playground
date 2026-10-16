import { useMemo, useState } from 'react';
import { truthTable, truthTableCsv } from '../simulator/circuit';
import type { Circuit } from '../types';
import { download } from '../utils/files';

export default function TruthTablePanel({ circuit, onMsg }: { circuit: Circuit; onMsg: (m: string) => void }) {
  const [version, setVersion] = useState(0);
  // Switch values do not change the table, so only structure and names are part of the key.
  const key = JSON.stringify([circuit.comps.map((c) => [c.id, c.type, c.name]), circuit.wires, version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const table = useMemo(() => truthTable(circuit), [key]);

  if (!table.ok) return <div className="p-2 text-[var(--mu)]">{table.error}</div>;

  const live = circuit.comps.filter((c) => c.type === 'SW').map((c) => c.val).join();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(truthTableCsv(table));
      onMsg('Truth table copied');
    } catch {
      onMsg('Clipboard is not available');
    }
  };

  return (
    <div className="p-2">
      <div className="mb-1 flex gap-1.5">
        <button className="btn" onClick={() => setVersion(version + 1)}>Regenerate</button>
        <button className="btn" onClick={() => download('truth-table.csv', truthTableCsv(table), 'text/csv')}>Export CSV</button>
        <button className="btn" onClick={copy}>Copy</button>
        <span className="self-center text-xs text-[var(--mu)]">{table.rows.length} rows</span>
      </div>
      <table className="tt">
        <thead>
          <tr>{[...table.inputs, ...table.outputs].map((h, i) => <th key={i}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {table.rows.map((r, i) => (
            <tr key={i} className={r.in.join() === live ? 'cur' : ''}>
              {[...r.in, ...r.out].map((v, k) => <td key={k}>{v}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
