// The "vault rings" allocation chart of spec 07, flat for the mini program (canvas 2D, no WebGL): one ring per asset,
// outermost first, the arc proportional to its weight from 12 o'clock, ticks at the band's min, target and max.
const COLORS = { USDC: '#8fb4ff', tXAU: '#d4af37', tXAG: '#c7ccd4' };
const TRACK = 'rgba(255,255,255,0.06)';
const TICK = '#f4f5f2';
const TURN = 2 * Math.PI;
const TOP = -Math.PI / 2;

const clamp = (bps) => Math.min(10000, Math.max(0, Number(bps) || 0));

function geometry(assets, opts) {
  const size = opts.size;
  const stroke = opts.stroke;
  const center = size / 2;
  const rings = assets.map((a, i) => {
    const radius = center - stroke / 2 - i * (stroke + opts.gap);
    const inner = radius - stroke / 2 - 2;
    const outer = radius + stroke / 2 + 2;
    const ticks = a.band
      ? [['min', a.band.minBps], ['target', a.band.targetBps], ['max', a.band.maxBps]].map(([kind, bps]) => {
        const angle = TOP + (TURN * clamp(bps)) / 10000;
        return {
          kind, angle,
          x1: center + inner * Math.cos(angle), y1: center + inner * Math.sin(angle),
          x2: center + outer * Math.cos(angle), y2: center + outer * Math.sin(angle),
        };
      })
      : [];
    const w = clamp(a.weightBps);
    return {
      symbol: a.symbol, color: COLORS[a.symbol] || TICK, radius, stroke, start: TOP, end: TOP + (TURN * w) / 10000, ticks,
      outside: !!a.band && (w < a.band.minBps || w > a.band.maxBps),
    };
  });
  return { size, center, rings };
}

/** Paints a geometry on a 2D context (already scaled to the device pixel ratio by the caller). */
function draw(ctx, g) {
  for (const r of g.rings) {
    ctx.lineWidth = r.stroke;
    ctx.lineCap = 'round';
    ctx.strokeStyle = TRACK;
    ctx.beginPath();
    ctx.arc(g.center, g.center, r.radius, 0, TURN);
    ctx.stroke();
    ctx.strokeStyle = r.color;
    ctx.beginPath();
    ctx.arc(g.center, g.center, r.radius, r.start, r.end);
    ctx.stroke();
    ctx.lineCap = 'butt';
    for (const t of r.ticks) {
      ctx.lineWidth = t.kind === 'target' ? 1 : 2;
      ctx.strokeStyle = TICK;
      ctx.beginPath();
      ctx.moveTo(t.x1, t.y1);
      ctx.lineTo(t.x2, t.y2);
      ctx.stroke();
    }
  }
}

module.exports = { geometry, draw, COLORS };
