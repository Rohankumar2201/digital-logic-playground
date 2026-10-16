import { defs, groups } from '../simulator/components';
import type { TypeId } from '../types';

export default function Sidebar({ onAdd }: { onAdd: (t: TypeId) => void }) {
  return (
    <aside className="w-40 shrink-0 overflow-auto border-r border-[var(--bd)] bg-[var(--pn)] p-2">
      {groups.map(([name, types]) => (
        <div key={name}>
          <h4 className="mono mb-1 mt-3 text-[10px] font-semibold tracking-widest text-[var(--mu)]">{name}</h4>
          {types.map((t) => (
            <button
              key={t}
              draggable
              onDragStart={(e) => e.dataTransfer.setData('text/plain', t)}
              onClick={() => onAdd(t)}
              className="btn my-0.5 block w-full cursor-grab text-left"
            >
              {defs[t].title}
            </button>
          ))}
        </div>
      ))}
    </aside>
  );
}
