// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — key art painting primitives (canvas 2D): color mixing, sky
// gradients, glows, retro striped suns, ridge silhouettes, haze, painterly
// clouds and brush strokes, plus the shared finish (brush texture, grain,
// warm wash, vignette). Used by keyart-scenes.ts.
// ─────────────────────────────────────────────────────────────────────────────

/** Main-thread canvas or an OffscreenCanvas in the key-art worker (keyart.worker.ts). */
export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type Rng = () => number;

/** Scratch canvas for patterns: a DOM canvas on the page, an OffscreenCanvas in a worker. */
function scratch2d(w: number, h: number): { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: Ctx | null } {
  if (typeof document === 'undefined') {
    const canvas = new OffscreenCanvas(w, h);
    return { canvas, ctx: canvas.getContext('2d') };
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d') };
}

// ── Color helpers ───────────────────────────────────────────────────────────

/** Parses '#rrggbb' or 'rgb(r,g,b)'. */
export function rgb(c: string): [number, number, number] {
  if (c.charCodeAt(0) === 35) {
    const n = parseInt(c.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = c.match(/\d+/g) ?? ['0', '0', '0'];
  return [Number(m[0]), Number(m[1]), Number(m[2])];
}

export function mix(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  const k = Math.max(0, Math.min(1, t));
  return `rgb(${Math.round(x[0] + (y[0] - x[0]) * k)},${Math.round(x[1] + (y[1] - x[1]) * k)},${Math.round(x[2] + (y[2] - x[2]) * k)})`;
}

export function rgba(hex: string, a: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// ── Painting primitives ─────────────────────────────────────────────────────

export function sky(ctx: Ctx, w: number, h: number, stops: [number, string][]): void {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  for (const [o, c] of stops) g.addColorStop(o, c);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

export function glow(ctx: Ctx, x: number, y: number, r: number, color: string, a: number): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(color, a));
  g.addColorStop(0.35, rgba(color, a * 0.45));
  g.addColorStop(1, rgba(color, 0));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.restore();
}

/** Retro striped sun disc, clipped at the horizon. */
export function sun(ctx: Ctx, x: number, y: number, r: number, top: string, bottom: string, horizon: number, stripeColor: string | null): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, ctx.canvas.width, horizon);
  ctx.clip();
  const g = ctx.createLinearGradient(0, y - r, 0, y + r);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  if (stripeColor) {
    ctx.fillStyle = stripeColor;
    for (let i = 0; i < 5; i++) {
      const sy = y + r * (0.1 + i * 0.19);
      const th = r * (0.035 + i * 0.022);
      ctx.fillRect(x - r - 2, sy, r * 2 + 4, th);
    }
  }
  ctx.restore();
}

/** Midpoint-displacement ridge line filled to the bottom. */
export function ridge(ctx: Ctx, rng: Rng, opts: { x0: number; x1: number; base: number; amp: number; rough: number; color: string; peaks?: [number, number][]; rim?: string; bottom?: number }): number[] {
  const n = 128;
  const pts: number[] = new Array(n + 1).fill(0);
  // Seed with optional peaks (fraction x, height fraction of amp).
  let step = n;
  pts[0] = rng() * opts.amp * 0.5;
  pts[n] = rng() * opts.amp * 0.5;
  let scale = opts.amp;
  while (step > 1) {
    const half = step / 2;
    for (let i = half; i < n; i += step) {
      pts[i] = (pts[i - half] + pts[i + half]) / 2 + (rng() - 0.5) * scale;
    }
    scale *= opts.rough;
    step = half;
  }
  if (opts.peaks) {
    for (let i = 0; i <= n; i++) {
      const fx = i / n;
      let add = 0;
      for (const [px, ph] of opts.peaks) {
        const d = Math.abs(fx - px);
        add = Math.max(add, Math.max(0, 1 - d * 3.2) ** 1.6 * ph * opts.amp);
      }
      pts[i] += add;
    }
  }
  const ys = pts.map((p) => opts.base - Math.max(0, p));
  const bottom = opts.bottom ?? ctx.canvas.height;
  ctx.beginPath();
  ctx.moveTo(opts.x0, bottom);
  for (let i = 0; i <= n; i++) ctx.lineTo(opts.x0 + ((opts.x1 - opts.x0) * i) / n, ys[i]);
  ctx.lineTo(opts.x1, bottom);
  ctx.closePath();
  ctx.fillStyle = opts.color;
  ctx.fill();
  if (opts.rim) {
    ctx.save();
    ctx.strokeStyle = opts.rim;
    ctx.lineWidth = Math.max(1, ctx.canvas.height / 500);
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const x = opts.x0 + ((opts.x1 - opts.x0) * i) / n;
      if (i === 0) ctx.moveTo(x, ys[i]);
      else ctx.lineTo(x, ys[i]);
    }
    ctx.stroke();
    ctx.restore();
  }
  return ys;
}

/** Soft horizontal haze band. */
export function haze(ctx: Ctx, y: number, height: number, color: string, a: number): void {
  const g = ctx.createLinearGradient(0, y - height, 0, y + height);
  g.addColorStop(0, rgba(color, 0));
  g.addColorStop(0.5, rgba(color, a));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, y - height, ctx.canvas.width, height * 2);
}

/** Painterly elongated streak clouds. */
export function streaks(ctx: Ctx, rng: Rng, n: number, yMin: number, yMax: number, colors: string[], alpha: number): void {
  const w = ctx.canvas.width;
  const u = ctx.canvas.height / 100;
  ctx.save();
  for (let i = 0; i < n; i++) {
    const cx = rng() * w * 1.2 - w * 0.1;
    const cy = yMin + rng() * (yMax - yMin);
    const len = (0.12 + rng() * 0.35) * w;
    const th = (0.25 + rng() * 1.1) * u;
    const c = colors[Math.floor(rng() * colors.length)];
    const g = ctx.createLinearGradient(cx - len / 2, 0, cx + len / 2, 0);
    g.addColorStop(0, rgba(c, 0));
    g.addColorStop(0.3 + rng() * 0.2, rgba(c, alpha * (0.5 + rng() * 0.5)));
    g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy, len / 2, th, (rng() - 0.5) * 0.03, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Puffy cloud cluster lit from one side (soft, overlapping, slightly squashed blobs). */
export function puff(ctx: Ctx, rng: Rng, x: number, y: number, size: number, lit: string, shade: string, a = 1): void {
  ctx.save();
  ctx.globalAlpha = a;
  const blobs = 6 + Math.floor(rng() * 5);
  for (let i = 0; i < blobs; i++) {
    const bx = x + (rng() - 0.5) * size * 2.6;
    const by = y + (rng() - 0.7) * size * 0.5;
    const br = size * (0.45 + rng() * 0.5);
    ctx.save();
    ctx.translate(bx, by);
    ctx.scale(1.35, 0.72);
    const g = ctx.createRadialGradient(-br * 0.2, -br * 0.5, br * 0.05, 0, 0, br);
    g.addColorStop(0, lit);
    g.addColorStop(0.45, mix(lit, shade, 0.45));
    g.addColorStop(0.8, rgba(mix(lit, shade, 0.8), 0.55));
    g.addColorStop(1, rgba(shade, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, br, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

/** Short brush strokes laid over a region (texture + painterly light). */
export function brush(ctx: Ctx, rng: Rng, count: number, region: [number, number, number, number], colors: string[], alpha: number, angle = 0, lenU = 2.2): void {
  const u = ctx.canvas.height / 100;
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const x = region[0] + rng() * region[2];
    const y = region[1] + rng() * region[3];
    const len = (0.4 + rng()) * lenU * u;
    const a = angle + (rng() - 0.5) * 0.5;
    ctx.strokeStyle = rgba(colors[Math.floor(rng() * colors.length)], alpha * (0.4 + rng() * 0.6));
    ctx.lineWidth = (0.15 + rng() * 0.45) * u;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  ctx.restore();
}

/** Canvas-wide finish: brush texture (overlay), grain and vignette. */
export function finish(ctx: Ctx, rng: Rng, warm: string): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  // Brush texture pattern.
  const { canvas: tile, ctx: t } = scratch2d(384, 384);
  if (t) {
    t.lineCap = 'round';
    // Short, fat, low-contrast dabs in two stroke directions read as paint, not rain.
    for (let i = 0; i < 900; i++) {
      const x = rng() * 384;
      const y = rng() * 384;
      const a = (rng() < 0.6 ? -0.25 : 0.9) + (rng() - 0.5) * 0.5;
      const len = 3 + rng() * 9;
      t.strokeStyle = rng() < 0.5 ? `rgba(255,255,255,${0.025 + rng() * 0.05})` : `rgba(0,0,0,${0.025 + rng() * 0.05})`;
      t.lineWidth = 2 + rng() * 5;
      t.beginPath();
      t.moveTo(x, y);
      t.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      t.stroke();
    }
    const pat = ctx.createPattern(tile, 'repeat');
    if (pat) {
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }
  // Grain.
  const { canvas: g, ctx: gc } = scratch2d(128, 128);
  if (gc) {
    const img = gc.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.floor(rng() * 255);
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 18;
    }
    gc.putImageData(img, 0, 0);
    const pat = ctx.createPattern(g, 'repeat');
    if (pat) {
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }
  // Warm light wash + vignette.
  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  ctx.fillStyle = rgba(warm, 0.18);
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
  const v = ctx.createRadialGradient(w / 2, h * 0.55, h * 0.35, w / 2, h * 0.55, h * 1.05);
  v.addColorStop(0, 'rgba(20,14,20,0)');
  v.addColorStop(1, 'rgba(20,14,20,0.55)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
}

