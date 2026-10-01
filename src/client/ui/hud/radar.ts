// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — HUD radar: a circular, player-up minimap.
//
// The map layer is painted ONCE per match from the collision solids (a relief
// plan: floors dark, raised structures lighter, tall walls outlined) into an
// offscreen canvas. Each frame (throttled to ~30 Hz) that layer is drawn
// rotated/translated under the player, then the contacts on top:
//   • you: centre arrow + soft view cone
//   • teammates: arrows in their team colour (clamped to the rim when far)
//   • enemies: only while/just after they fire (classic radar rule), fading
//   • zones (team-coloured letters) and the Sunspear pickup (gold), rim-clamped
// Styled like the rest of the HUD: thin warm lines, dial ticks, a north mark,
// a slow sweep. Content is spatial, so it never mirrors in RTL.
// ─────────────────────────────────────────────────────────────────────────────

import type { HudRadar } from '../../contracts';
import type { MapDef } from '../../../shared/maps/types';

/** Metres from the centre to the rim. */
const RANGE_M = 42;
/** Seconds between redraws (the HUD calls update every frame). */
const REDRAW = 1 / 30;
const TAU = Math.PI * 2;

function mixHex(a: [number, number, number], b: [number, number, number], t: number, alpha: number): string {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgba(${r},${g},${bl},${alpha})`;
}

const FLOOR: [number, number, number] = [74, 67, 58];
const HIGH: [number, number, number] = [228, 214, 190];

export class Radar {
  readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private map: HTMLCanvasElement | null = null;
  private mapX = 0;
  private mapZ = 0;
  private mapW = 1;
  private mapD = 1;
  private enabled = true;
  private hasData = false;
  private acc = REDRAW;
  private time = 0;
  private size = 0;
  private north = 'N';
  private readonly ro: ResizeObserver | null = null;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'hud-radar';
    this.el.setAttribute('dir', 'ltr');
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'hud-radar__cv';
    this.el.append(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    // Size the backing store from the CSS box only when it changes (HUD scale,
    // viewport) — never a layout read per frame.
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver((entries) => {
        const w = entries[0]?.contentRect.width ?? 0;
        this.resize(w);
      });
      this.ro.observe(this.el);
    }
  }

  private resize(cssW: number): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = Math.max(2, Math.round(cssW * dpr));
    if (px === this.size) return;
    this.size = px;
    this.canvas.width = px;
    this.canvas.height = px;
    this.acc = REDRAW;
  }

  setNorthLabel(label: string): void {
    this.north = label || 'N';
  }

  /** User setting. */
  setEnabled(on: boolean): void {
    this.enabled = on;
    this.applyVisibility();
  }

  private applyVisibility(): void {
    this.el.classList.toggle('is-on', this.enabled && this.hasData && !!this.map);
  }

  /** Paints the relief plan of a map (once per match); null clears it. */
  setMap(def: MapDef | null): void {
    this.map = null;
    if (def) this.map = this.paintMap(def);
    this.applyVisibility();
  }

  private paintMap(def: MapDef): HTMLCanvasElement | null {
    const b = def.bounds;
    const w = Math.max(1, b.max.x - b.min.x);
    const d = Math.max(1, b.max.z - b.min.z);
    const ppm = Math.min(4, 1024 / Math.max(w, d));
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(w * ppm);
    cv.height = Math.ceil(d * ppm);
    const g = cv.getContext('2d');
    if (!g) return null;
    this.mapX = b.min.x;
    this.mapZ = b.min.z;
    this.mapW = w;
    this.mapD = d;

    // Ground level = the lowest common floor; heights above it set the tone.
    const solids = def.solids.filter(
      (s) => !s.walkThrough && s.max.x > b.min.x && s.min.x < b.max.x && s.max.z > b.min.z && s.min.z < b.max.z,
    );
    let ground = Infinity;
    for (const s of solids) ground = Math.min(ground, s.max.y);
    if (!Number.isFinite(ground)) ground = 0;
    solids.sort((a, c) => a.max.y - c.max.y);

    g.fillStyle = mixHex(FLOOR, FLOOR, 0, 0.55);
    g.fillRect(0, 0, cv.width, cv.height);
    const lw = Math.max(1, ppm * 0.35);
    for (const s of solids) {
      const x0 = (s.min.x - b.min.x) * ppm;
      const z0 = (s.min.z - b.min.z) * ppm;
      const sw = Math.max(lw, (s.max.x - s.min.x) * ppm);
      const sd = Math.max(lw, (s.max.z - s.min.z) * ppm);
      const h = s.max.y - ground;
      const t = Math.max(0, Math.min(1, h / 10));
      const tall = s.max.y - s.min.y > 2.4;
      g.fillStyle = mixHex(FLOOR, HIGH, 0.08 + t * 0.7, 0.92);
      g.fillRect(x0, z0, sw, sd);
      if (tall || h > 0.6) {
        // Outline structures so walls and cover read crisply at radar scale.
        g.strokeStyle = mixHex(FLOOR, HIGH, Math.min(1, 0.45 + t * 0.6), tall ? 0.9 : 0.5);
        g.lineWidth = lw;
        g.strokeRect(x0 + lw / 2, z0 + lw / 2, Math.max(0, sw - lw), Math.max(0, sd - lw));
      }
    }
    if (typeof def.waterY === 'number') {
      // Flooded areas: a faint cool sheen over floors below the water line.
      g.fillStyle = 'rgba(120,150,160,0.18)';
      for (const s of solids) {
        if (s.max.y > (def.waterY as number) + 0.05) continue;
        g.fillRect((s.min.x - b.min.x) * ppm, (s.min.z - b.min.z) * ppm, (s.max.x - s.min.x) * ppm, (s.max.z - s.min.z) * ppm);
      }
    }
    return cv;
  }

  update(dt: number, r: HudRadar | null | undefined): void {
    const has = !!r;
    if (has !== this.hasData) {
      this.hasData = has;
      this.applyVisibility();
    }
    if (!r || !this.enabled || !this.map || !this.ctx) return;
    this.time += dt;
    this.acc += dt;
    if (this.acc < REDRAW) return;
    this.acc = 0;
    if (!this.size) this.resize(this.el.clientWidth);
    this.draw(this.ctx, r);
  }

  private draw(g: CanvasRenderingContext2D, r: HudRadar): void {
    const S = this.size;
    const C = S / 2;
    const rim = C * 0.94;
    const k = rim / RANGE_M; // px per metre
    const cos = Math.cos(r.yaw);
    const sin = Math.sin(r.yaw);
    const unit = S / 160; // icon scale relative to a 160 px radar

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, S, S);

    // ── Disc + map layer (clipped) ──
    g.save();
    g.beginPath();
    g.arc(C, C, rim, 0, TAU);
    g.clip();
    g.fillStyle = 'rgba(18,16,14,0.66)';
    g.fillRect(0, 0, S, S);
    if (this.map) {
      g.save();
      g.translate(C, C);
      g.rotate(r.yaw);
      g.scale(k, k);
      g.translate(-r.x, -r.z);
      g.globalAlpha = 0.95;
      g.drawImage(this.map, this.mapX, this.mapZ, this.mapW, this.mapD);
      g.restore();
    }
    // Range ring + slow sweep.
    g.strokeStyle = 'rgba(243,236,224,0.12)';
    g.lineWidth = Math.max(1, unit * 0.8);
    g.beginPath();
    g.arc(C, C, rim * 0.5, 0, TAU);
    g.stroke();
    const sweep = (this.time * 0.9) % TAU;
    g.fillStyle = 'rgba(243,236,224,0.05)';
    g.beginPath();
    g.moveTo(C, C);
    g.arc(C, C, rim, sweep - 0.5, sweep);
    g.closePath();
    g.fill();
    // View cone (points up).
    const half = Math.max(0.3, Math.min(1.2, r.fov / 2));
    const cone = g.createRadialGradient(C, C, 0, C, C, rim * 0.85);
    cone.addColorStop(0, 'rgba(243,236,224,0.22)');
    cone.addColorStop(1, 'rgba(243,236,224,0)');
    g.fillStyle = cone;
    g.beginPath();
    g.moveTo(C, C);
    g.arc(C, C, rim * 0.85, -Math.PI / 2 - half, -Math.PI / 2 + half);
    g.closePath();
    g.fill();
    g.restore();

    // ── Contacts ──
    const toScreen = (x: number, z: number, out: { x: number; y: number; d: number }): void => {
      const dx = x - r.x;
      const dz = z - r.z;
      out.x = (dx * cos - dz * sin) * k;
      out.y = (dx * sin + dz * cos) * k;
      out.d = Math.hypot(out.x, out.y);
    };
    const p = { x: 0, y: 0, d: 0 };
    // Draw order: zones/pickups under players, enemies on top.
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < r.count; i++) {
        const b = r.blips[i];
        const layer = b.kind === 'zone' || b.kind === 'pickup' ? 0 : b.kind === 'friend' ? 1 : 2;
        if (layer !== pass) continue;
        toScreen(b.x, b.z, p);
        let clamped = false;
        const lim = rim - 7 * unit;
        if (p.d > lim) {
          if (b.kind === 'enemy') continue; // enemies: only inside the range
          p.x *= lim / p.d;
          p.y *= lim / p.d;
          clamped = true;
        }
        const x = C + p.x;
        const y = C + p.y;
        g.globalAlpha = Math.max(0, Math.min(1, b.alpha)) * (clamped && b.kind === 'friend' ? 0.55 : 1);
        if (b.kind === 'zone') this.drawZone(g, x, y, unit * (clamped ? 0.8 : 1), b.color, b.label, b.pulse);
        else if (b.kind === 'pickup') this.drawDiamond(g, x, y, unit * 4.2 * (clamped ? 0.8 : 1), b.color);
        else if (b.kind === 'friend') this.drawArrow(g, x, y, r.yaw - b.yaw, unit * 5, b.color, 'rgba(20,18,16,0.85)');
        else this.drawEnemy(g, x, y, unit * 4.4, b.color);
      }
    }
    g.globalAlpha = 1;

    // ── You ──
    this.drawArrow(g, C, C, 0, unit * 6.4, '#f3ece0', 'rgba(20,18,16,0.9)');

    // ── Rim, dial ticks (world-locked) and north mark ──
    g.strokeStyle = 'rgba(243,236,224,0.42)';
    g.lineWidth = Math.max(1, unit * 1.1);
    g.beginPath();
    g.arc(C, C, rim, 0, TAU);
    g.stroke();
    g.strokeStyle = 'rgba(243,236,224,0.5)';
    g.lineWidth = Math.max(1, unit * 0.9);
    for (let i = 0; i < 12; i++) {
      // World direction i*30° from north (-z), rotated into radar space.
      const a = r.yaw + (i * Math.PI) / 6;
      const sx = Math.sin(a);
      const sy = -Math.cos(a);
      const inner = i % 3 === 0 ? rim - 6 * unit : rim - 3.5 * unit;
      g.beginPath();
      g.moveTo(C + sx * inner, C + sy * inner);
      g.lineTo(C + sx * rim, C + sy * rim);
      g.stroke();
    }
    const nx = C + Math.sin(r.yaw) * (rim - 12 * unit);
    const ny = C - Math.cos(r.yaw) * (rim - 12 * unit);
    g.font = `600 ${Math.round(9.5 * unit)}px "JetBrains Mono", ui-monospace, monospace`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#f0b35b';
    g.fillText(this.north, nx, ny + 0.5 * unit);
  }

  private drawArrow(g: CanvasRenderingContext2D, x: number, y: number, rot: number, s: number, fill: string, edge: string): void {
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    g.beginPath();
    g.moveTo(0, -s);
    g.lineTo(s * 0.72, s * 0.78);
    g.lineTo(0, s * 0.36);
    g.lineTo(-s * 0.72, s * 0.78);
    g.closePath();
    g.lineWidth = Math.max(1, s * 0.22);
    g.strokeStyle = edge;
    g.stroke();
    g.fillStyle = fill;
    g.fill();
    g.restore();
  }

  private drawDiamond(g: CanvasRenderingContext2D, x: number, y: number, s: number, fill: string): void {
    g.beginPath();
    g.moveTo(x, y - s);
    g.lineTo(x + s, y);
    g.lineTo(x, y + s);
    g.lineTo(x - s, y);
    g.closePath();
    g.lineWidth = Math.max(1, s * 0.3);
    g.strokeStyle = 'rgba(20,18,16,0.85)';
    g.stroke();
    g.fillStyle = fill;
    g.fill();
  }

  private drawEnemy(g: CanvasRenderingContext2D, x: number, y: number, s: number, fill: string): void {
    g.beginPath();
    g.arc(x, y, s, 0, TAU);
    g.lineWidth = Math.max(1, s * 0.35);
    g.strokeStyle = 'rgba(20,18,16,0.85)';
    g.stroke();
    g.fillStyle = fill;
    g.fill();
  }

  private drawZone(g: CanvasRenderingContext2D, x: number, y: number, unit: number, color: string, label: string, pulse: boolean): void {
    const rr = 7 * unit;
    if (pulse) {
      const ph = (this.time * 1.6) % 1;
      g.save();
      g.globalAlpha *= 1 - ph;
      g.strokeStyle = color;
      g.lineWidth = Math.max(1, unit * 1.2);
      g.beginPath();
      g.arc(x, y, rr * (1 + ph * 0.8), 0, TAU);
      g.stroke();
      g.restore();
    }
    g.beginPath();
    g.arc(x, y, rr, 0, TAU);
    g.fillStyle = 'rgba(20,18,16,0.82)';
    g.fill();
    g.lineWidth = Math.max(1, unit * 1.4);
    g.strokeStyle = color;
    g.stroke();
    g.font = `700 ${Math.round(8.5 * unit)}px "JetBrains Mono", ui-monospace, monospace`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = color;
    g.fillText(label, x, y + 0.5 * unit);
  }

  dispose(): void {
    this.ro?.disconnect();
    this.map = null;
  }
}
