// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Training Range signage atlas.
//
// Every painted sign, plaque, stencil and ground number of the proving ground
// is drawn once into one canvas atlas; quads referencing it are merged into
// two meshes: opaque boards (standard material) and ground/wall decals
// (alpha-tested paint with polygon offset). Two draw calls for all signage.
// Style: 1970s institutional graphics — Space Grotesk / JetBrains Mono caps,
// bone and faded terracotta, sun-bleached, thin rules, small dial motifs.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';
import type { MaterialLibrary } from '../../../contracts';
import { ENV } from '../../../engine/palette';
import type { RGB, RangeKit } from './kit';

type Draw = (x: CanvasRenderingContext2D, w: number, h: number) => void;

interface Entry {
  id: string;
  w: number;
  h: number;
  draw: Draw;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

const INK = '#3a332c';
const BONE = ENV.bone;
const TERRA = ENV.terracottaFaded;
const FONT = '"Space Grotesk", system-ui, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';

/** Weathering: speckle + streaks so no board looks freshly printed. */
function weather(x: CanvasRenderingContext2D, w: number, h: number, seed: number, amt = 1): void {
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  x.save();
  for (let i = 0; i < (w * h) / 900; i++) {
    x.fillStyle = rnd() < 0.5 ? `rgba(60,50,40,${0.05 * amt})` : `rgba(255,250,235,${0.06 * amt})`;
    x.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 1 + rnd() * 2);
  }
  for (let i = 0; i < 6 * amt; i++) {
    const gx = rnd() * w;
    const g = x.createLinearGradient(gx, 0, gx, h);
    g.addColorStop(0, 'rgba(90,70,50,0.08)');
    g.addColorStop(1, 'rgba(90,70,50,0)');
    x.fillStyle = g;
    x.fillRect(gx, 0, 2 + rnd() * 5, h);
  }
  x.restore();
}

export class SignAtlas {
  private readonly entries = new Map<string, Entry>();
  private readonly order: Entry[] = [];
  private tex: THREE.Texture | null = null;
  private readonly boards = { pos: [] as number[], nor: [] as number[], uv: [] as number[] };
  private readonly decals = { pos: [] as number[], nor: [] as number[], uv: [] as number[] };
  private readonly owned: { dispose(): void }[] = [];

  constructor(private readonly lib: MaterialLibrary, private readonly low: boolean) {}

  /** Registers a sign image (px size in the high-res atlas). */
  def(id: string, w: number, h: number, draw: Draw): void {
    const e: Entry = { id, w, h, draw, u0: 0, v0: 0, u1: 0, v1: 0 };
    this.entries.set(id, e);
    this.order.push(e);
  }

  /** Packs + paints the atlas (call once after all def()s). */
  bake(): void {
    const W = 2048;
    // Shelf packing (tallest first).
    const sorted = [...this.order].sort((a, b) => b.h - a.h);
    let x = 0;
    let y = 0;
    let row = 0;
    const pad = 4;
    for (const e of sorted) {
      if (x + e.w > W) {
        x = 0;
        y += row + pad;
        row = 0;
      }
      e.u0 = x;
      e.v0 = y;
      x += e.w + pad;
      row = Math.max(row, e.h);
    }
    const H = Math.pow(2, Math.ceil(Math.log2(y + row + pad)));
    const scale = this.low ? 0.5 : 1;
    this.tex = this.lib.canvasTexture(`range.atlas.${scale}`, W * scale, H * scale, (c) => {
      c.clearRect(0, 0, W * scale, H * scale);
      for (const e of sorted) {
        c.save();
        c.translate(e.u0 * scale, e.v0 * scale);
        c.scale(scale, scale);
        c.beginPath();
        c.rect(0, 0, e.w, e.h);
        c.clip();
        e.draw(c, e.w, e.h);
        c.restore();
      }
    });
    for (const e of sorted) {
      const u0 = e.u0 / W;
      const u1 = (e.u0 + e.w) / W;
      // Canvas y down → texture v up (flipY).
      const v1 = 1 - e.v0 / H;
      const v0 = 1 - (e.v0 + e.h) / H;
      e.u0 = u0;
      e.u1 = u1;
      e.v0 = v0;
      e.v1 = v1;
    }
  }

  private quad(target: 'boards' | 'decals', id: string, m: THREE.Matrix4, w: number, h: number): void {
    const e = this.entries.get(id);
    if (!e) return;
    const b = this[target];
    const corners = [
      [-w / 2, -h / 2, e.u0, e.v0],
      [w / 2, -h / 2, e.u1, e.v0],
      [w / 2, h / 2, e.u1, e.v1],
      [-w / 2, h / 2, e.u0, e.v1],
    ];
    const n = new THREE.Vector3(0, 0, 1).transformDirection(m);
    const p = new THREE.Vector3();
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const c = corners[i];
      p.set(c[0], c[1], 0).applyMatrix4(m);
      b.pos.push(p.x, p.y, p.z);
      b.nor.push(n.x, n.y, n.z);
      b.uv.push(c[2], c[3]);
    }
  }

  /** Vertical board centred at `pos`, facing yaw `ry` (0 = facing +Z). Height `h` (m); width from the image aspect. */
  board(id: string, pos: THREE.Vector3, ry: number, h: number, decal = false): number {
    const e = this.entries.get(id);
    if (!e) return 0;
    const w = (h * e.w) / e.h;
    const m = new THREE.Matrix4().makeRotationY(ry).setPosition(pos);
    this.quad(decal ? 'decals' : 'boards', id, m, w, h);
    return w;
  }

  /** A free-standing board: the sign face on a slim ceramic backing plate (solid from behind). */
  backed(k: RangeKit, id: string, pos: THREE.Vector3, ry: number, h: number, color: RGB, depth = 0.05): void {
    const e = this.entries.get(id);
    if (!e) return;
    const w = (h * e.w) / e.h;
    const off = depth / 2 + 0.004;
    this.board(id, new THREE.Vector3(pos.x + Math.sin(ry) * off, pos.y, pos.z + Math.cos(ry) * off), ry, h);
    k.boxR('ceramic', pos.x, pos.y, pos.z, w + 0.05, h + 0.05, depth, ry, color, 0.015);
  }

  /** Flat ground decal at `pos` (y = surface), text reading toward yaw `ry`. Size by width `w`. */
  ground(id: string, pos: THREE.Vector3, ry: number, w: number): void {
    const e = this.entries.get(id);
    if (!e) return;
    const h = (w * e.h) / e.w;
    const m = new THREE.Matrix4().makeRotationY(ry).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
    m.setPosition(pos);
    this.quad('decals', id, m, w, h);
  }

  /** Builds the two meshes under `root`. */
  build(root: THREE.Group, shadows: boolean): number {
    let calls = 0;
    const tex = this.tex;
    if (!tex) return 0;
    const make = (b: { pos: number[]; nor: number[]; uv: number[] }, decal: boolean): void => {
      if (!b.pos.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      g.computeBoundingSphere();
      const mat = this.low
        ? new THREE.MeshLambertMaterial({ map: tex, transparent: decal, alphaTest: decal ? 0.05 : 0.5 })
        : new THREE.MeshStandardMaterial({ map: tex, roughness: 0.82, transparent: decal, alphaTest: decal ? 0.05 : 0.5 });
      if (decal) {
        mat.depthWrite = false;
        mat.polygonOffset = true;
        mat.polygonOffsetFactor = -2;
        mat.polygonOffsetUnits = -2;
      }
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = decal ? 'range.decals' : 'range.signs';
      mesh.receiveShadow = shadows;
      mesh.castShadow = false;
      mesh.renderOrder = decal ? 2 : 0;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      root.add(mesh);
      this.owned.push(g, mat);
      calls++;
    };
    make(this.boards, false);
    make(this.decals, true);
    return calls;
  }

  dispose(): void {
    for (const o of this.owned) o.dispose();
    this.owned.length = 0;
  }
}

// ── Sign library ────────────────────────────────────────────────────────────

function plate(x: CanvasRenderingContext2D, w: number, h: number, bg: string, border = INK): void {
  x.fillStyle = bg;
  x.fillRect(0, 0, w, h);
  x.strokeStyle = border;
  x.lineWidth = Math.max(3, h * 0.035);
  x.strokeRect(x.lineWidth, x.lineWidth, w - x.lineWidth * 2, h - x.lineWidth * 2);
}

function text(x: CanvasRenderingContext2D, s: string, cx: number, cy: number, size: number, color = INK, font = FONT, weight = 700, spacing = 0): void {
  x.fillStyle = color;
  x.font = `${weight} ${size}px ${font}`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  if (spacing) {
    const chars = [...s];
    const widths = chars.map((c) => x.measureText(c).width + spacing);
    const total = widths.reduce((a, b) => a + b, 0) - spacing;
    let px = cx - total / 2;
    x.textAlign = 'left';
    chars.forEach((c, i) => {
      x.fillText(c, px, cy);
      px += widths[i];
    });
    return;
  }
  x.fillText(s, cx, cy);
}

/** A small dial / sunburst motif (the Halcyon agency mark). */
function dialMark(x: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  x.save();
  x.strokeStyle = color;
  x.fillStyle = color;
  x.lineWidth = Math.max(2, r * 0.09);
  x.beginPath();
  x.arc(cx, cy, r, 0, Math.PI * 2);
  x.stroke();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    x.beginPath();
    x.moveTo(cx + Math.cos(a) * r * 0.62, cy + Math.sin(a) * r * 0.62);
    x.lineTo(cx + Math.cos(a) * r * (i % 3 === 0 ? 0.35 : 0.48), cy + Math.sin(a) * r * (i % 3 === 0 ? 0.35 : 0.48));
    x.stroke();
  }
  x.beginPath();
  x.arc(cx, cy, r * 0.18, 0, Math.PI * 2);
  x.fill();
  x.restore();
}

/** Registers every range sign. */
export function defineRangeSigns(a: SignAtlas, weaponNames: string[]): void {
  // Distance boards on the lane posts.
  for (const d of [10, 25, 50, 75, 100]) {
    a.def(`dist.${d}`, 256, 160, (x, w, h) => {
      plate(x, w, h, BONE);
      x.fillStyle = TERRA;
      x.fillRect(10, h - 34, w - 20, 22);
      text(x, `${d}`, w / 2, h * 0.42, 86, INK, MONO, 700);
      text(x, 'METRES', w / 2, h - 23, 17, BONE, FONT, 700, 5);
      weather(x, w, h, d);
    });
    // Big painted ground numbers (read from the firing line).
    a.def(`ground.${d}`, 320, 160, (x, w, h) => {
      x.clearRect(0, 0, w, h);
      x.globalAlpha = 0.78;
      text(x, `${d}`, w / 2, h / 2 + 4, 138, BONE, MONO, 700);
      x.globalAlpha = 1;
      // Scuffed paint: knock holes out of the numerals.
      x.globalCompositeOperation = 'destination-out';
      let s = d * 7;
      for (let i = 0; i < 420; i++) {
        s = (s * 9301 + 49297) % 233280;
        const px = (s / 233280) * w;
        s = (s * 9301 + 49297) % 233280;
        const py = (s / 233280) * h;
        x.fillRect(px, py, 2 + (i % 4), 1 + (i % 3));
      }
      x.globalCompositeOperation = 'source-over';
    });
  }
  // Big berm sign.
  a.def('berm', 1024, 200, (x, w, h) => {
    plate(x, w, h, BONE);
    x.fillStyle = TERRA;
    x.fillRect(14, 14, 190, h - 28);
    dialMark(x, 109, h / 2, 62, BONE);
    text(x, 'HALCYON PROVING GROUND', 614, 80, 50, INK, FONT, 700, 3);
    text(x, 'RANGE 7  ·  LIVE FIRE  ·  EST. 2071', 614, 146, 26, '#6b5f52', MONO, 500, 2);
    weather(x, w, h, 7, 1.4);
  });
  a.def('firingline', 640, 90, (x, w, h) => {
    x.fillStyle = ENV.shadowWarm;
    x.fillRect(0, 0, w, h);
    text(x, 'FIRING LINE', w / 2, h / 2 + 2, 50, BONE, FONT, 700, 10);
    weather(x, w, h, 3, 0.8);
  });
  for (let i = 1; i <= 6; i++) {
    a.def(`bay.${i}`, 96, 96, (x, w, h) => {
      x.fillStyle = BONE;
      x.beginPath();
      x.arc(w / 2, h / 2, w / 2 - 3, 0, Math.PI * 2);
      x.fill();
      x.strokeStyle = TERRA;
      x.lineWidth = 6;
      x.stroke();
      text(x, String(i), w / 2, h / 2 + 3, 54, INK, MONO, 700);
    });
  }
  a.def('armory', 480, 110, (x, w, h) => {
    plate(x, w, h, TERRA, BONE);
    text(x, 'ARMORY', w / 2, h / 2 + 2, 60, BONE, FONT, 700, 9);
  });
  weaponNames.forEach((n, i) => {
    a.def(`rack.${i}`, 256, 64, (x, w, h) => {
      const g = x.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#d9b36b');
      g.addColorStop(1, '#a8834a');
      x.fillStyle = g;
      x.fillRect(0, 0, w, h);
      x.strokeStyle = '#6d5530';
      x.lineWidth = 3;
      x.strokeRect(2, 2, w - 4, h - 4);
      text(x, n.toUpperCase(), w / 2, h / 2 + 2, 30, '#3b2d18', FONT, 700, 3);
    });
  });
  a.def('console.reset', 256, 96, (x, w, h) => {
    plate(x, w, h, ENV.shadowWarm, '#8a7c6c');
    text(x, 'RESET RANGE', w / 2, h / 2 + 2, 34, '#f0dcb4', MONO, 700, 3);
  });
  a.def('console.speed', 256, 96, (x, w, h) => {
    plate(x, w, h, ENV.shadowWarm, '#8a7c6c');
    text(x, 'TARGET SPEED', w / 2, h / 2 + 2, 32, '#f0dcb4', MONO, 700, 2);
  });
  // Course station signs.
  const stations = ['SPRINT', 'JUMP', 'MANTLE', 'SLIDE', 'PERCH', 'PIT'];
  stations.forEach((s, i) => {
    a.def(`course.${i}`, 420, 140, (x, w, h) => {
      plate(x, w, h, BONE);
      x.fillStyle = TERRA;
      x.beginPath();
      x.arc(70, h / 2, 46, 0, Math.PI * 2);
      x.fill();
      text(x, String(i + 1), 70, h / 2 + 3, 58, BONE, MONO, 700);
      text(x, s, 262, h / 2 + 3, 58, INK, FONT, 700, 6);
      weather(x, w, h, 20 + i);
    });
    a.def(`stencil.${i}`, 512, 128, (x, w, h) => {
      x.clearRect(0, 0, w, h);
      x.globalAlpha = 0.72;
      text(x, s, w / 2, h / 2 + 4, 104, BONE, FONT, 700, 16);
      x.globalAlpha = 1;
      x.globalCompositeOperation = 'destination-out';
      // Stencil bridges.
      for (let bx = 30; bx < w; bx += 58) x.fillRect(bx, 0, 5, h);
      x.globalCompositeOperation = 'source-over';
    });
  });
  // Sprint chevrons (ground paint).
  a.def('chevron', 256, 128, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    x.fillStyle = 'rgba(201,154,130,0.85)';
    x.beginPath();
    x.moveTo(20, h - 10);
    x.lineTo(w / 2, 14);
    x.lineTo(w - 20, h - 10);
    x.lineTo(w - 70, h - 10);
    x.lineTo(w / 2, 64);
    x.lineTo(70, h - 10);
    x.closePath();
    x.fill();
  });
  // Hazard edge stripes (terracotta / bone, never a team color).
  a.def('hazard', 512, 64, (x, w, h) => {
    x.fillStyle = BONE;
    x.fillRect(0, 0, w, h);
    x.fillStyle = ENV.terracotta;
    for (let i = -2; i < 12; i++) {
      x.beginPath();
      x.moveTo(i * 56, h);
      x.lineTo(i * 56 + 28, h);
      x.lineTo(i * 56 + 28 + h, 0);
      x.lineTo(i * 56 + h, 0);
      x.closePath();
      x.fill();
    }
    weather(x, w, h, 11, 1.2);
  });
  // Posters on the pavilion back (environmental storytelling).
  a.def('poster.safety', 300, 420, (x, w, h) => {
    x.fillStyle = ENV.pastelYellow;
    x.fillRect(0, 0, w, h);
    x.fillStyle = ENV.terracotta;
    x.beginPath();
    x.arc(w / 2, 150, 95, 0, Math.PI * 2);
    x.fill();
    dialMark(x, w / 2, 150, 70, ENV.pastelYellow);
    text(x, 'EYES', w / 2, 290, 58, INK, FONT, 700, 6);
    text(x, 'DOWNRANGE', w / 2, 340, 38, INK, FONT, 700, 3);
    text(x, 'HALCYON SAFETY BOARD', w / 2, 392, 16, '#6b5f52', MONO, 500, 2);
    weather(x, w, h, 31, 1.6);
  });
  a.def('poster.pilot', 300, 420, (x, w, h) => {
    x.fillStyle = ENV.pastelBlue;
    x.fillRect(0, 0, w, h);
    // A ceramic helmet silhouette with a visor line.
    x.fillStyle = BONE;
    x.beginPath();
    x.ellipse(w / 2, 175, 88, 100, 0, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = INK;
    x.fillRect(w / 2 - 78, 165, 156, 18);
    text(x, 'CALM', w / 2, 320, 56, INK, FONT, 700, 8);
    text(x, 'IS A SKILL', w / 2, 366, 30, INK, FONT, 700, 3);
    weather(x, w, h, 32, 1.6);
  });
  a.def('poster.schedule', 300, 420, (x, w, h) => {
    x.fillStyle = BONE;
    x.fillRect(0, 0, w, h);
    text(x, 'RANGE HOURS', w / 2, 46, 30, INK, FONT, 700, 2);
    x.fillStyle = TERRA;
    x.fillRect(24, 72, w - 48, 4);
    const rows = ['MON  0600–1900', 'TUE  0600–1900', 'WED  CLOSED', 'THU  0600–1900', 'FRI  0600–2100', 'SAT  0800–1600'];
    rows.forEach((r, i) => text(x, r, w / 2, 110 + i * 42, 22, '#4a4038', MONO, 500));
    weather(x, w, h, 33, 1.8);
  });
  // Tower sign.
  a.def('tower', 400, 90, (x, w, h) => {
    plate(x, w, h, BONE);
    text(x, 'RANGE CONTROL', w / 2, h / 2 + 2, 44, INK, FONT, 700, 4);
  });
}
