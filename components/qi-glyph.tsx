// Dot-matrix rendering of the QI 启 mark, sampled from the same geometry as
// public/qi-symbol.svg. Deterministic, so it renders identically on the server.
type P = [number, number];
const STROKE = 3.1;
const curve = (a: P, b: P, c: P, d: P, n = 12): P[] => Array.from({ length: n + 1 }, (_, i) => {
  const s = i / n, u = 1 - s;
  return [u * u * u * a[0] + 3 * u * u * s * b[0] + 3 * u * s * s * c[0] + s * s * s * d[0], u * u * u * a[1] + 3 * u * u * s * b[1] + 3 * u * s * s * c[1] + s * s * s * d[1]];
});
const polylines: P[][] = [
  [[26, 7.5], [38, 7.5]],
  [[15, 17], [49, 17], [49, 29], [15, 29]],
  [[15, 17], ...curve([15, 32], [15, 41], [11.5, 48], [6, 53.5])],
];
function segmentDistance(p: P, a: P, b: P) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = dx * dx + dy * dy;
  const k = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
  return Math.hypot(p[0] - a[0] - k * dx, p[1] - a[1] - k * dy);
}
function sample(p: P): 0 | 1 | 2 {
  for (const line of polylines) for (let i = 1; i < line.length; i++) if (segmentDistance(p, line[i - 1], line[i]) <= STROKE) return 1;
  const sun = Math.hypot(p[0] - 38, p[1] - 46) <= 10.4;
  return sun && !(p[1] > 47.2 && p[1] < 50.6) ? 2 : 0;
}
const STEP = 1.6, COUNT = 40;
const DOTS = Array.from({ length: COUNT * COUNT }, (_, i) => {
  const x = (i % COUNT) * STEP + STEP / 2, y = Math.floor(i / COUNT) * STEP + STEP / 2;
  return { x, y, kind: sample([x, y]), wave: (i * 7 + Math.floor(i / COUNT) * 3) % 9 };
});

export default function QiGlyph({ className = "" }: { className?: string }) {
  return <svg className={"qi-glyph " + className} viewBox="0 0 64 64" aria-hidden="true">
    {DOTS.map((d, i) => <circle key={i} cx={d.x.toFixed(2)} cy={d.y.toFixed(2)} r={d.kind ? .58 : .26} className={(d.kind === 1 ? "on" : d.kind === 2 ? "sun" : "off") + " w" + d.wave}/>)}
  </svg>;
}
