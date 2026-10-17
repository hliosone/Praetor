// The "vault rings" (spec 07): one ring per asset, filled to its weight, with tick marks at its band's min and max
// and a dot at its target. SVG only; it tilts slightly with the pointer (CSS 3D, at most 6 degrees).
import { useState } from 'react';
import type { Asset } from '../lib/api.js';

const COLOR: Record<string, string> = { USDC: 'var(--usdc)', tXAU: 'var(--gold)', tXAG: 'var(--silver)' };

export function Rings({ assets, label }: { assets: Asset[]; label: string }) {
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const size = 260;
  const c = size / 2;
  const point = (r: number, bps: number) => {
    const a = (bps / 10_000) * Math.PI * 2 - Math.PI / 2;
    return [c + r * Math.cos(a), c + r * Math.sin(a)] as const;
  };
  return (
    <div
      onPointerMove={(e) => {
        const b = e.currentTarget.getBoundingClientRect();
        setTilt({ x: ((e.clientY - b.top) / b.height - 0.5) * -12, y: ((e.clientX - b.left) / b.width - 0.5) * 12 });
      }}
      onPointerLeave={() => setTilt({ x: 0, y: 0 })}
      style={{ perspective: 800 }}
    >
      <svg viewBox={`0 0 ${size} ${size}`} width="100%" style={{ maxWidth: 300, transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`, transition: 'transform .2s' }} role="img" aria-label={label}>
        {assets.map((a, i) => {
          const r = 110 - i * 30;
          const circ = 2 * Math.PI * r;
          return (
            <g key={a.symbol}>
              <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(255,255,255,.07)" strokeWidth={16} />
              <circle cx={c} cy={c} r={r} fill="none" stroke={COLOR[a.symbol]} strokeWidth={16} strokeLinecap="round"
                strokeDasharray={`${(a.weightBps / 10_000) * circ} ${circ}`} transform={`rotate(-90 ${c} ${c})`} />
              {a.band && [a.band.minBps, a.band.maxBps].map((b) => {
                const [x1, y1] = point(r - 11, b);
                const [x2, y2] = point(r + 11, b);
                return <line key={b} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--ink)" strokeWidth={2} />;
              })}
              {a.band && (() => { const [x, y] = point(r, a.band.targetBps); return <circle cx={x} cy={y} r={3} fill="var(--ink)" />; })()}
            </g>
          );
        })}
      </svg>
      <div className="row" style={{ justifyContent: 'center' }}>
        {assets.map((a) => (
          <span className="chip" key={a.symbol}><i style={{ background: COLOR[a.symbol] }} />{a.symbol} {(a.weightBps / 100).toFixed(1)}%{a.band ? ` (${a.band.minBps / 100}-${a.band.maxBps / 100}%)` : ''}</span>
        ))}
      </div>
    </div>
  );
}
