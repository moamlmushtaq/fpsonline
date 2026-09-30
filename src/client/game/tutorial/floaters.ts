// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — Training Range floating hit numbers (used by range-stats).
//
// On every confirmed range hit a small mono number rises from the target
// (damage; headshot gold, elimination amber with a thin ring) with the
// measured distance under it ("27 m"). Pellets of one shot on the same
// target merge into one number. DOM spans projected each frame — a fixed pool
// of 14, no allocations in steady state, hidden in the cinematic HUD mode.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three';

const CSS = `
.hf-float { position: absolute; left: 0; top: 0; pointer-events: none; font-family: var(--f-mono, 'JetBrains Mono', monospace); text-align: center; direction: ltr; unicode-bidi: isolate;
  color: #f3ece0; text-shadow: 0 1px 2px rgba(0,0,0,.65), 0 0 10px rgba(0,0,0,.25); will-change: transform, opacity; opacity: 0; white-space: nowrap; }
.hf-float b { display: block; font-size: 1.02em; font-weight: 500; letter-spacing: .02em; }
.hf-float span { display: block; font-size: .66em; opacity: .7; margin-top: -.05em; }
.hf-float.is-head b { color: #ffd166; }
.hf-float.is-kill b { color: #f0b35b; }
.hf-float.is-kill b::after { content: ''; display: inline-block; width: .5em; height: .5em; margin-inline-start: .3em; border: 1.5px solid currentColor; border-radius: 50%; vertical-align: .08em; }
.hud.hf-cine .hf-floats { opacity: 0; }
`;

let injected = false;

interface Floater {
  el: HTMLElement;
  num: HTMLElement;
  dist: HTMLElement;
  pos: THREE.Vector3;
  t: number;
  dmg: number;
  target: number;
  at: number;
  live: boolean;
  dx: number;
}

const LIFE = 0.95;
const MERGE_MS = 70;

export class Floaters {
  private readonly root = document.createElement('div');
  private readonly pool: Floater[] = [];
  private readonly v = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();

  constructor(parent: HTMLElement) {
    if (!injected) {
      injected = true;
      const st = document.createElement('style');
      st.dataset.owner = 'range-floaters';
      st.textContent = CSS;
      document.head.append(st);
    }
    this.root.className = 'hf-floats';
    this.root.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
    parent.append(this.root);
    for (let i = 0; i < 14; i++) {
      const el = document.createElement('div');
      el.className = 'hf-float';
      const num = document.createElement('b');
      const dist = document.createElement('span');
      el.append(num, dist);
      this.root.append(el);
      this.pool.push({ el, num, dist, pos: new THREE.Vector3(), t: 0, dmg: 0, target: -1, at: 0, live: false, dx: 0 });
    }
  }

  /** A hit on target `id` at world position `p` (feet), `dist` metres from the shooter. */
  hit(id: number, p: { x: number; y: number; z: number }, dmg: number, head: boolean, kill: boolean, dist: number): void {
    const now = performance.now();
    let f = this.pool.find((x) => x.live && x.target === id && now - x.at < MERGE_MS);
    if (f) f.dmg += dmg;
    else {
      f = this.pool.find((x) => !x.live) ?? this.pool.reduce((a, b) => (a.t > b.t ? a : b));
      f.live = true;
      f.t = 0;
      f.dmg = dmg;
      f.target = id;
      f.dx = (Math.random() - 0.5) * 0.5;
      f.pos.set(p.x + f.dx, p.y + (head ? 2.05 : 1.55), p.z);
      f.el.className = 'hf-float';
    }
    f.at = now;
    f.num.textContent = String(Math.round(f.dmg));
    f.dist.textContent = `${Math.round(dist)} m`;
    if (head) f.el.classList.add('is-head');
    if (kill) f.el.classList.add('is-kill');
  }

  update(dt: number, camera: THREE.Camera, w: number, h: number): void {
    camera.getWorldDirection(this.fwd);
    for (const f of this.pool) {
      if (!f.live) continue;
      f.t += dt;
      if (f.t >= LIFE) {
        f.live = false;
        f.el.style.opacity = '0';
        continue;
      }
      const k = f.t / LIFE;
      const rise = 0.55 * (1 - (1 - k) * (1 - k));
      this.v.set(f.pos.x, f.pos.y + rise, f.pos.z);
      const ahead = (this.v.x - camera.position.x) * this.fwd.x + (this.v.y - camera.position.y) * this.fwd.y + (this.v.z - camera.position.z) * this.fwd.z;
      this.v.project(camera);
      if (ahead <= 0 || Math.abs(this.v.x) > 1.1 || Math.abs(this.v.y) > 1.1) {
        f.el.style.opacity = '0';
        continue;
      }
      const x = ((this.v.x + 1) / 2) * w;
      const y = ((1 - this.v.y) / 2) * h;
      // Distant numbers stay readable but a touch smaller.
      const d = Math.sqrt(Math.max(1, (f.pos.x - camera.position.x) ** 2 + (f.pos.z - camera.position.z) ** 2));
      const s = Math.max(0.7, Math.min(1.15, 14 / d + 0.62)) * (k < 0.12 ? 0.85 + k * 1.25 : 1);
      f.el.style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${s.toFixed(3)})`;
      f.el.style.opacity = String(k < 0.1 ? k * 10 : k > 0.7 ? (1 - k) / 0.3 : 1);
    }
  }

  clear(): void {
    for (const f of this.pool) {
      f.live = false;
      f.el.style.opacity = '0';
    }
  }

  dispose(): void {
    this.root.remove();
  }
}
