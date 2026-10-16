import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as RPointerEvent } from 'react';
import { defs } from '../simulator/components';
import { canConnect, inVals } from '../simulator/engine';
import { finishWire, moveSelection, press, release } from '../simulator/interaction';
import type { Drag, Target } from '../simulator/interaction';
import { curve, heightOf, pinPos, pinY } from '../utils/geometry';
import { isTyping } from '../utils/keyboard';
import { NO_SELECTION } from '../types';
import type { Circuit, PinRef, Selection, TypeId, View } from '../types';

interface Props {
  circuit: Circuit;
  sel: Selection;
  view: View;
  onSel: (s: Selection) => void;
  onView: (v: View) => void;
  onPreview: (c: Circuit) => void;
  onCommit: (next: Circuit, before: Circuit) => void;
  onPlace: (t: TypeId, x: number, y: number) => void;
  onMsg: (m: string) => void;
}

export default function Canvas(p: Props) {
  const { circuit, sel, view } = p;
  const ref = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const pan = useRef<{ sx: number; sy: number; vx: number; vy: number } | null>(null);
  const moved = useRef(false);
  const origin = useRef({ x: 0, y: 0 });
  const cancelRef = useRef(() => {});
  const space = useRef(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  const onViewRef = useRef(p.onView);
  onViewRef.current = p.onView;
  const [wire, setWire] = useState<{ from: PinRef; x: number; y: number } | null>(null);
  const [hov, setHov] = useState<(PinRef & { ok: boolean }) | null>(null);

  const toWorld = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.x) / view.k, y: (e.clientY - r.top - view.y) / view.k };
  };

  useEffect(() => {
    const svg = ref.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current, r = svg.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const k = Math.min(2.5, Math.max(0.3, v.k * (e.deltaY < 0 ? 1.1 : 0.9)));
      onViewRef.current({ x: mx - ((mx - v.x) * k) / v.k, y: my - ((my - v.y) * k) / v.k, k });
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelRef.current();
      if (isTyping(e.target as HTMLElement)) return;
      if (e.code === 'Space') {
        space.current = e.type === 'keydown';
        if (e.type === 'keydown') e.preventDefault();
      }
    };
    svg.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', key);
    return () => {
      svg.removeEventListener('wheel', wheel);
      window.removeEventListener('keydown', key);
      window.removeEventListener('keyup', key);
    };
  }, []);

  const cancel = () => {
    const d = drag.current;
    drag.current = null;
    pan.current = null;
    if (d) p.onPreview(d.start);
    setWire(null);
    setHov(null);
  };
  cancelRef.current = cancel;

  const targetOf = (el: Element): Target => {
    const pin = el.closest('[data-pin]') as SVGElement | null;
    if (pin) return { k: 'pin', pin: { c: Number(pin.dataset.c), k: pin.dataset.k as 'i' | 'o', p: Number(pin.dataset.p) } };
    const cm = el.closest('[data-comp]') as SVGElement | null;
    if (cm) return { k: 'comp', id: Number(cm.dataset.comp) };
    const wr = el.closest('[data-wire]') as SVGElement | null;
    return wr ? { k: 'wire', id: Number(wr.dataset.wire) } : { k: 'empty' };
  };

  const down = (e: RPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const target = targetOf(e.target as Element);
    ref.current!.focus();
    ref.current!.setPointerCapture(e.pointerId);
    origin.current = { x: e.clientX, y: e.clientY };
    moved.current = false;
    if (space.current || target.k === 'empty') {
      if (!space.current && !e.shiftKey) p.onSel(NO_SELECTION);
      pan.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
      return;
    }
    const w = toWorld(e);
    const r = press(circuit, sel, target, e.shiftKey, w);
    p.onSel(r.sel);
    if (r.circuit !== circuit) p.onPreview(r.circuit);
    drag.current = r.drag;
    if (r.drag?.t === 'wire') setWire({ from: r.drag.from, x: w.x, y: w.y });
  };

  const move = (e: RPointerEvent<SVGSVGElement>) => {
    if (pan.current) {
      p.onView({ ...view, x: pan.current.vx + e.clientX - pan.current.sx, y: pan.current.vy + e.clientY - pan.current.sy });
      return;
    }
    const d = drag.current;
    if (!d) return;
    const w = toWorld(e);
    if (d.t === 'move') {
      if (!moved.current && Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) < 4) return;
      moved.current = true;
      p.onPreview(moveSelection(circuit, d, w));
    } else if (wire) {
      setWire({ ...wire, x: w.x, y: w.y });
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-pin]') as SVGElement | null | undefined;
      if (!el) return setHov(null);
      const target: PinRef = { c: Number(el.dataset.c), k: el.dataset.k as 'i' | 'o', p: Number(el.dataset.p) };
      const [ok] = canConnect(circuit, d.from, target);
      setHov({ ...target, ok });
    }
  };

  const up = () => {
    pan.current = null;
    const d = drag.current;
    drag.current = null;
    if (d?.t === 'move') {
      const r = release(circuit, d, moved.current);
      if (r) p.onCommit(r.next, r.before);
    } else if (d?.t === 'wire') {
      const r = finishWire(circuit, d, hov ? { c: hov.c, k: hov.k, p: hov.p } : null);
      if (r.error) p.onMsg(r.error);
      p.onCommit(r.next, r.before);
    }
    setWire(null);
    setHov(null);
  };

  const drop = (e: React.DragEvent) => {
    e.preventDefault();
    const t = e.dataTransfer.getData('text/plain') as TypeId;
    if (t in defs) {
      const w = toWorld(e);
      p.onPlace(t, w.x - 40, w.y - 20);
    }
  };

  const hovCls = (c: number, k: string, pn: number) =>
    hov && hov.c === c && hov.k === k && hov.p === pn ? (hov.ok ? ' ok' : ' bad') : '';

  return (
    <svg
      ref={ref}
      className="h-full w-full touch-none select-none outline-none"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancel}
      tabIndex={0}
      onDragOver={(e) => e.preventDefault()}
      onDrop={drop}
    >
      <defs>
        <pattern id="g" width={20} height={20} patternUnits="userSpaceOnUse" patternTransform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          <circle cx={1} cy={1} r={1} fill="var(--gr)" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#g)" />
      <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
        {circuit.wires.map((w) => {
          const [x1, y1] = pinPos(circuit, w.from.c, 'o', w.from.p);
          const [x2, y2] = pinPos(circuit, w.to.c, 'i', w.to.p);
          const d = curve(x1, y1, x2, y2);
          const on = circuit.comps.find((c) => c.id === w.from.c)!.out[w.from.p];
          const selected = sel.wires.includes(w.id);
          return (
            <g key={w.id}>
              <path className={`w${on ? ' hi' : ''}${selected ? ' sel' : ''}`} d={d} />
              <path d={d} fill="none" stroke="transparent" strokeWidth={12} data-wire={w.id} />
            </g>
          );
        })}
        {circuit.comps.map((c) => {
          const d = defs[c.type], W = d.w, H = heightOf(c), iv = inVals(circuit, c);
          const on = c.type === 'LED' ? iv[0] : c.val;
          return (
            <g key={c.id} data-comp={c.id} transform={`translate(${c.x} ${c.y})`}>
              <rect className={`blk${sel.comps.includes(c.id) ? ' sel' : ''}`} width={W} height={H} rx={3} />
              <text className="nm" y={-6}>{c.name}</text>
              {c.type === 'LED' && <circle className={`led${on ? ' hi' : ''}`} cx={W / 2} cy={H / 2} r={9} />}
              {(c.type === 'SW' || c.type === 'CLK') && (
                <text className={`big${on ? ' hi' : ''}`} x={W / 2} y={H / 2 + 6}>{c.val}</text>
              )}
              {!d.io && <text className="lbl" x={W / 2} y={H / 2 + 4}>{d.label}</text>}
              {d.in.map((n, k) => (
                <g key={'i' + k}>
                  <circle className={`pin${iv[k] ? ' hi' : ''}${hovCls(c.id, 'i', k)}`} cx={0} cy={pinY(k)} r={5} />
                  {d.pn && <text className="pl" x={9} y={pinY(k) + 3}>{n}</text>}
                  <circle cx={0} cy={pinY(k)} r={11} fill="transparent" data-pin="" data-c={c.id} data-k="i" data-p={k} />
                </g>
              ))}
              {d.out.map((n, k) => (
                <g key={'o' + k}>
                  <circle className={`pin${c.out[k] ? ' hi' : ''}${hovCls(c.id, 'o', k)}`} cx={W} cy={pinY(k)} r={5} />
                  {d.pn && <text className="pl" textAnchor="end" x={W - 9} y={pinY(k) + 3}>{n}</text>}
                  <circle cx={W} cy={pinY(k)} r={11} fill="transparent" data-pin="" data-c={c.id} data-k="o" data-p={k} />
                </g>
              ))}
            </g>
          );
        })}
        {wire && (() => {
          const [px, py] = pinPos(circuit, wire.from.c, wire.from.k, wire.from.p);
          const d = wire.from.k === 'o' ? curve(px, py, wire.x, wire.y) : curve(wire.x, wire.y, px, py);
          return <path className={`w tmp${hov ? (hov.ok ? ' ok' : ' bad') : ''}`} d={d} />;
        })()}
      </g>
    </svg>
  );
}
