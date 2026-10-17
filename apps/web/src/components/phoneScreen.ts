// What the phone shows, painted on a 2D canvas: the texture of the 3D phone and, unchanged, the flat replica
// without WebGL. Strings come in already translated. Colours follow the tokens: green executed, amber waiting for a
// human, red refused or frozen; asset colours only in the donut.
export const SCREEN_W = 360;
export const SCREEN_H = 760;

export type Slice = { label: string; weightBps: number; color: string; minBps?: number; maxBps?: number };
export type PhoneScreen =
  | { kind: 'approval'; title: string; subtitle: string; action: string; approved?: boolean }
  | { kind: 'portfolio'; title: string; total: string; slices: Slice[] }
  | { kind: 'frozen'; title: string; text: string }
  | { kind: 'decision'; title: string; text: string; tone: 'ok' | 'wait' | 'no' };

const C = { paper: '#0b0c0e', ink: '#f4f5f2', graphite: '#9aa1a9', signed: '#34d399', asked: '#fbbf24', refused: '#f87171', sheet: '#16181b' };
const font = (w: number, s: number) => `${w} ${s}px Inter, system-ui, -apple-system, 'PingFang SC', 'Noto Sans SC', sans-serif`;

function chrome(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  ctx.fillStyle = C.ink;
  ctx.font = font(650, 15);
  ctx.textAlign = 'left';
  ctx.fillText('9:41', 28, 40);
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.roundRect(SCREEN_W / 2 - 55, 18, 110, 30, 15);
  ctx.fill();
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, line: number) {
  const words = text.split(/(\s+)/);
  let cur = '';
  for (const w of words) {
    const next = cur + w;
    if (ctx.measureText(next).width > max && cur.trim()) {
      ctx.fillText(cur.trim(), x, y);
      y += line;
      cur = w.trimStart();
    } else cur = next;
  }
  if (cur.trim()) ctx.fillText(cur.trim(), x, y);
  return y;
}

function faceId(ctx: CanvasRenderingContext2D, cx: number, cy: number, done: boolean) {
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.strokeStyle = done ? C.signed : C.ink;
  if (done) {
    ctx.beginPath();
    ctx.arc(cx, cy, 44, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 20, cy + 2);
    ctx.lineTo(cx - 5, cy + 18);
    ctx.lineTo(cx + 22, cy - 14);
    ctx.stroke();
    return;
  }
  const r = 44;
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    ctx.beginPath();
    ctx.moveTo(cx + sx * r, cy + sy * (r - 16));
    ctx.lineTo(cx + sx * r, cy + sy * r);
    ctx.lineTo(cx + sx * (r - 16), cy + sy * r);
    ctx.stroke();
  }
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(cx - 14, cy - 12); ctx.lineTo(cx - 14, cy - 4); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx + 14, cy - 12); ctx.lineTo(cx + 14, cy - 4); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy + 6, 14, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
}

export function paintScreen(ctx: CanvasRenderingContext2D, s: PhoneScreen) {
  chrome(ctx);
  ctx.textAlign = 'center';
  const mid = SCREEN_W / 2;
  if (s.kind === 'approval') {
    ctx.fillStyle = C.sheet;
    ctx.beginPath();
    ctx.roundRect(16, 330, SCREEN_W - 32, 400, 28);
    ctx.fill();
    ctx.fillStyle = C.asked;
    ctx.font = font(650, 15);
    ctx.fillText('Praetor', mid, 380);
    ctx.fillStyle = C.ink;
    ctx.font = font(750, 30);
    wrap(ctx, s.title, mid, 432, SCREEN_W - 70, 36);
    ctx.fillStyle = C.graphite;
    ctx.font = font(400, 19);
    wrap(ctx, s.subtitle, mid, 500, SCREEN_W - 70, 26);
    faceId(ctx, mid, 600, !!s.approved);
    ctx.fillStyle = s.approved ? C.signed : C.graphite;
    ctx.font = font(500, 16);
    ctx.fillText(s.action, mid, 690);
    return;
  }
  if (s.kind === 'portfolio') {
    ctx.fillStyle = C.graphite;
    ctx.font = font(500, 17);
    ctx.fillText(s.title, mid, 140);
    ctx.fillStyle = C.ink;
    ctx.font = font(750, 40);
    ctx.fillText(s.total, mid, 190);
    const cx = mid, cy = 400, r = 110;
    let a = -Math.PI / 2;
    ctx.lineWidth = 34;
    for (const sl of s.slices) {
      const sweep = (sl.weightBps / 10_000) * Math.PI * 2;
      ctx.strokeStyle = sl.color;
      ctx.beginPath();
      ctx.arc(cx, cy, r, a + 0.02, a + Math.max(0.02, sweep - 0.02));
      ctx.stroke();
      a += sweep;
    }
    ctx.font = font(500, 17);
    s.slices.forEach((sl, i) => {
      const y = 590 + i * 38;
      ctx.fillStyle = sl.color;
      ctx.fillRect(60, y - 13, 14, 14);
      ctx.fillStyle = C.ink;
      ctx.textAlign = 'left';
      ctx.fillText(sl.label, 86, y);
      ctx.textAlign = 'right';
      ctx.fillText(`${(sl.weightBps / 100).toFixed(1)}%`, SCREEN_W - 60, y);
      ctx.textAlign = 'center';
    });
    return;
  }
  if (s.kind === 'frozen') {
    ctx.fillStyle = 'rgba(248,113,113,0.16)';
    ctx.fillRect(0, 60, SCREEN_W, SCREEN_H - 60);
    ctx.strokeStyle = C.refused;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.roundRect(mid - 44, 300, 88, 76, 12);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(mid, 300, 30, Math.PI, 0);
    ctx.stroke();
    ctx.fillStyle = C.refused;
    ctx.font = font(750, 30);
    wrap(ctx, s.title, mid, 450, SCREEN_W - 60, 36);
    ctx.fillStyle = C.ink;
    ctx.font = font(400, 18);
    wrap(ctx, s.text, mid, 540, SCREEN_W - 60, 26);
    return;
  }
  const tone = s.tone === 'ok' ? C.signed : s.tone === 'wait' ? C.asked : C.refused;
  ctx.fillStyle = C.sheet;
  ctx.beginPath();
  ctx.roundRect(24, 300, SCREEN_W - 48, 220, 24);
  ctx.fill();
  ctx.fillStyle = tone;
  ctx.fillRect(24, 300, 6, 220);
  ctx.font = font(750, 24);
  wrap(ctx, s.title, mid, 360, SCREEN_W - 90, 30);
  ctx.fillStyle = C.ink;
  ctx.font = font(400, 18);
  wrap(ctx, s.text, mid, 430, SCREEN_W - 90, 26);
}
