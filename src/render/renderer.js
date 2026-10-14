// Three.js-weergave: scène, camera die de boksers volgt, schudden en effecten.
import * as THREE from 'three';
import { Arena } from './arena.js';
import { FighterView, TEAM } from './fighterView.js';
import { Effects } from './effects.js';

export class Renderer {
  constructor(canvas, game) {
    this.game = game;
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x06070b);
    this.scene.fog = new THREE.Fog(0x06070b, 11, 26);
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 80);
    this.camera.position.set(0, 2.2, 6);
    this.arena = new Arena(this.scene);
    this.effects = new Effects(this.scene);
    this.views = [];
    this.trauma = 0;
    this.shakeEnabled = true;
    this.shakeT = 0;
    this.camState = { pos: new THREE.Vector3(0, 2.4, 7), look: new THREE.Vector3(0, 1.1, 0), side: new THREE.Vector3(0, 0, 1) };
    this.mode = 'menu';
    this.orbit = 0;
    this.focus = null;
    this.focusAmount = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.rebuildFighters();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Smalle schermen: iets verder uitzoomen zodat beide boksers in beeld blijven.
    this.camera.fov = w / h < 1 ? 52 : 36;
    this.camera.updateProjectionMatrix();
  }

  rebuildFighters() {
    for (const v of this.views) v.dispose();
    this.views = this.game.fighters.map((f, i) => new FighterView(this.scene, f, TEAM[i]));
    this.focus = null;
    this.focusAmount = 0;
  }

  addTrauma(t) {
    if (!this.shakeEnabled) return;
    this.trauma = Math.min(1, this.trauma + t);
  }

  onEvent(e) {
    switch (e.type) {
      case 'spawn':
        this.rebuildFighters();
        break;
      case 'hit': {
        const strength = Math.min(1, e.damage / 16);
        this.effects.impact(e.pos, e.dir, e.blocked ? 0.25 : strength, e.blocked ? 'block' : e.zone);
        if (!e.blocked) {
          this.views[e.defender]?.hitFlash(0.4 + strength * 0.6);
          this.addTrauma(0.12 + strength * 0.3);
          this.arena.excite(0.08 + strength * 0.25);
          if (strength > 0.6) this.arena.burstFlashes(6);
        } else this.addTrauma(0.05);
        if (e.ko) {
          this.addTrauma(0.6);
          this.arena.excite(1);
          this.arena.burstFlashes(40);
        }
        break;
      }
      case 'ko':
        this.focus = e.loser;
        break;
      case 'roundStart':
        this.focus = null;
        break;
      case 'fight':
        this.arena.excite(0.5);
        this.arena.burstFlashes(12);
        break;
      case 'matchEnd':
        this.arena.excite(1);
        this.arena.burstFlashes(30);
        break;
      default:
        break;
    }
  }

  // Wereldpositie → schermpixels (voor schadegetallen).
  project(v) {
    const p = v.clone().project(this.camera);
    return { x: (p.x * 0.5 + 0.5) * window.innerWidth, y: (-p.y * 0.5 + 0.5) * window.innerHeight, visible: p.z < 1 };
  }

  // Horizontale camera-assen voor schermrelatieve besturing.
  basis() {
    const f = new THREE.Vector3();
    this.camera.getWorldDirection(f);
    f.y = 0;
    if (f.lengthSq() < 1e-6) f.set(0, 0, -1);
    f.normalize();
    const r = new THREE.Vector3(-f.z, 0, f.x);
    return { forward: f, right: r };
  }

  updateCamera(dt) {
    const fighters = this.game.fighters;
    const cs = this.camState;
    let targetPos;
    let targetLook;
    if (this.mode === 'menu' || fighters.length < 2) {
      this.orbit += dt * 0.08;
      const r = 6.8;
      targetPos = new THREE.Vector3(Math.sin(this.orbit) * r, 2.6 + Math.sin(this.orbit * 0.7) * 0.4, Math.cos(this.orbit) * r);
      targetLook = new THREE.Vector3(0, 1.0, 0);
    } else {
      const a = fighters[0].parts.pelvis ? fighters[0].pos() : new THREE.Vector3(-1, 0.9, 0);
      const b = fighters[1].parts.pelvis ? fighters[1].pos() : new THREE.Vector3(1, 0.9, 0);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const axis = b.clone().sub(a).setY(0);
      const sep = axis.length();
      if (sep > 1e-3) axis.divideScalar(sep);
      // Camera staat loodrecht op de lijn tussen de boksers, speler 1 altijd links.
      const side = new THREE.Vector3(-axis.z, 0, axis.x);
      cs.side.lerp(side, Math.min(1, dt * 2.5)).normalize();
      const narrow = this.camera.aspect < 1;
      const dist = (narrow ? 3.4 : 3.0) + sep * (narrow ? 1.4 : 0.95);
      targetLook = new THREE.Vector3(mid.x, 1.05, mid.z);
      targetPos = targetLook.clone().addScaledVector(cs.side, dist).add(new THREE.Vector3(0, 0.95, 0));
      // Bij een knock-out langzaam inzoomen op de verliezer.
      if (this.focus !== null && fighters[this.focus]?.parts.head) {
        this.focusAmount = Math.min(1, this.focusAmount + dt * 0.6);
        const h = fighters[this.focus].pos('chest');
        const lookAt = h.clone().setY(Math.max(0.5, h.y));
        targetLook.lerp(lookAt, this.focusAmount * 0.7);
        targetPos.lerp(lookAt.clone().addScaledVector(cs.side, 2.4).add(new THREE.Vector3(0, 0.9, 0)), this.focusAmount * 0.6);
      }
    }
    const k = Math.min(1, dt * (this.mode === 'menu' ? 1.2 : 4));
    cs.pos.lerp(targetPos, k);
    cs.look.lerp(targetLook, k);
    this.camera.position.copy(cs.pos);
    this.camera.lookAt(cs.look);

    // Schudden met afnemend 'trauma'.
    if (this.trauma > 0) {
      this.shakeT += dt * 32;
      const s = this.trauma * this.trauma;
      this.camera.position.x += Math.sin(this.shakeT * 1.7) * 0.08 * s;
      this.camera.position.y += Math.sin(this.shakeT * 2.3) * 0.06 * s;
      this.camera.rotateZ(Math.sin(this.shakeT * 1.1) * 0.03 * s);
      this.trauma = Math.max(0, this.trauma - dt * 1.6);
    }
  }

  render(realDt) {
    const alpha = this.game.alpha;
    for (const v of this.views) v.update(alpha, realDt);
    this.arena.update(realDt);
    this.effects.update(realDt * (this.game.hitStop > 0 ? 0.15 : this.game.slowmo));
    this.updateCamera(realDt);
    this.renderer.render(this.scene, this.camera);
  }
}
