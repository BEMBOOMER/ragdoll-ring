// Three.js-weergave: scène, camera die de boksers volgt, schudden, effecten en herhalingen.
import * as THREE from 'three';
import { Arena } from './arena.js';
import { FighterView, TEAM, Marks } from './fighterView.js';
import { Effects } from './effects.js';
import { Referee } from './referee.js';
import { arenaEnvironment } from './materials.js';
import { RING_HALF } from '../game/constants.js';

export class Renderer {
  constructor(canvas, game) {
    this.game = game;
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // Filmische tone mapping: contrast zoals bij een tv-uitzending, hoge lichten lopen zacht af.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    // Reflecties van de zaal op huid, leer, metaal en zweet.
    this.scene.environment = arenaEnvironment(this.renderer);
    this.scene.environmentIntensity = 0.35;
    this.scene.background = new THREE.Color(0x06070b);
    this.scene.fog = new THREE.Fog(0x06070b, 11, 26);
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 80);
    this.camera.position.set(0, 2.2, 6);
    this.arena = new Arena(this.scene);
    this.effects = new Effects(this.scene);
    this.referee = new Referee(this.scene);
    this.marks = [new Marks(), new Marks()];
    this.views = [];
    this.trauma = 0;
    this.shakeEnabled = true;
    this.blood = true;
    this.shakeT = 0;
    this.camState = { pos: new THREE.Vector3(0, 2.4, 7), look: new THREE.Vector3(0, 1.1, 0), side: new THREE.Vector3(0, 0, 1) };
    this.mode = 'menu';
    this.orbit = 0;
    this.focus = null;
    this.focusAmount = 0;
    this.replay = null;
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
    // Buiten een wedstrijd begint elke bokser schoon; in een wedstrijd blijven de sporen staan.
    if (this.game.mode !== 'match') for (const m of this.marks) m.reset();
    this.views = this.game.fighters.map((f, i) => new FighterView(this.scene, f, TEAM[i], this.marks[i]));
    this.focus = null;
    this.focusAmount = 0;
  }

  addTrauma(t) {
    if (!this.shakeEnabled) return;
    this.trauma = Math.min(1, this.trauma + t);
  }

  onEvent(e) {
    switch (e.type) {
      case 'matchStart':
        for (const m of this.marks) m.reset();
        this.effects.clearBlood();
        break;
      case 'spawn':
        this.rebuildFighters();
        break;
      case 'hit': {
        const strength = Math.min(1, e.damage / 16);
        this.effects.impact(e.pos, e.dir, e.blocked ? 0.25 : strength, e.blocked ? 'block' : e.zone);
        if (!e.blocked) {
          const view = this.views[e.defender];
          view?.mark(e, this.blood);
          // Bloed: uit een cut of neus, en op de handschoen die raakte.
          if (this.blood && e.zone === 'head' && view?.marks.bleeding) {
            this.effects.bleed(e.pos, e.dir, strength);
            this.views[e.attacker]?.marks.gloves[e.punch === 'jab' || e.punch === 'leftHook' ? 'L' : 'R'].stain(strength);
          }
          this.addTrauma(0.12 + strength * 0.3);
          this.arena.excite(0.08 + strength * 0.25);
          if (strength > 0.6) this.arena.burstFlashes(6);
        } else this.addTrauma(0.05);
        if (e.knockdown) {
          this.addTrauma(0.6);
          this.arena.excite(1);
          this.arena.burstFlashes(40);
        }
        break;
      }
      case 'knockdown':
        this.focus = e.fighter.side;
        break;
      case 'thud':
        this.addTrauma(Math.min(0.35, e.speed * 0.08));
        break;
      case 'resume':
      case 'roundStart':
        this.focus = null;
        break;
      case 'ko':
        this.focus = e.loser;
        this.arena.excite(1);
        this.arena.burstFlashes(30);
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

  // ---------- herhaling ----------
  // Speelt een opgenomen stuk af: normaal tempo, rond de treffer in slowmotion,
  // met een camera die om de getroffen bokser heen draait.
  playReplay(clip, onDone) {
    if (!clip) {
      onDone?.();
      return;
    }
    const impact = clip.impact;
    const hitAt = clip.at ?? clip.from + (clip.to - clip.from) * 0.4;
    this.replay = { clip, t: clip.from, hitAt, impact, onDone, shown: false, angle: Math.random() * Math.PI * 2 };
    this.trauma = 0;
  }

  stopReplay() {
    const r = this.replay;
    if (!r) return;
    this.replay = null;
    r.onDone?.();
  }

  updateReplay(dt) {
    const r = this.replay;
    const near = Math.abs(r.t - r.hitAt);
    const speed = near < 0.35 ? 0.18 : near < 0.9 ? 0.45 : 0.9;
    r.t += dt * speed;
    this.game.replay.sample(r.t, (i, name, p, q) => this.views[i]?.setPart(name, p, q));
    if (!r.shown && r.t >= r.hitAt && r.impact) {
      r.shown = true;
      this.effects.impact(r.impact.pos, r.impact.dir, 1, r.impact.zone);
    }
    // Camera: draait langzaam om het hoofd van de verliezer.
    const loser = r.impact ? r.impact.defender : this.game.loser ?? 1;
    const head = this.views[loser]?.byPart.head?.position || new THREE.Vector3(0, 1.4, 0);
    r.angle += dt * 0.35;
    const close = 1 - Math.min(1, near / 1.2);
    const radius = 2.6 - close * 0.9;
    const target = new THREE.Vector3(head.x, Math.max(0.5, head.y), head.z);
    const pos = target.clone().add(new THREE.Vector3(Math.sin(r.angle) * radius, 0.35 + close * 0.1, Math.cos(r.angle) * radius));
    this.camera.position.lerp(pos, Math.min(1, dt * 3));
    this.camState.look.lerp(target, Math.min(1, dt * 4));
    this.camera.lookAt(this.camState.look);
    if (r.t >= r.clip.to) this.stopReplay();
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
      // Tijdens een telling (boksers ver uit elkaar) draait hij niet mee.
      const side = new THREE.Vector3(-axis.z, 0, axis.x);
      if (this.focus === null) cs.side.lerp(side, Math.min(1, dt * 2.5)).normalize();
      const narrow = this.camera.aspect < 1;
      const dist = (narrow ? 3.4 : 3.0) + Math.min(sep, 2.2) * (narrow ? 1.4 : 0.95);
      targetLook = new THREE.Vector3(mid.x, 1.05, mid.z);
      targetPos = targetLook.clone().addScaledVector(cs.side, dist).add(new THREE.Vector3(0, 0.95, 0));
      // Bij een knockdown of knock-out langzaam inzoomen op wie ligt.
      if (this.focus !== null && fighters[this.focus]?.parts.head) {
        this.focusAmount = Math.min(1, this.focusAmount + dt * 0.6);
        const h = fighters[this.focus].pos('chest');
        const lookAt = h.clone().setY(Math.max(0.5, h.y));
        targetLook.lerp(lookAt, this.focusAmount * 0.7);
        targetPos.lerp(lookAt.clone().addScaledVector(cs.side, 2.4).add(new THREE.Vector3(0, 0.9, 0)), this.focusAmount * 0.6);
      } else this.focusAmount = Math.max(0, this.focusAmount - dt);
      // Buiten de ring blijft de camera boven het bovenste touw, zodat hij er niet doorheen kijkt.
      const outside = Math.max(Math.abs(targetPos.x), Math.abs(targetPos.z)) > RING_HALF;
      if (outside) targetPos.y = Math.max(targetPos.y, 1.75);
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
    const live = !this.replay;
    for (const v of this.views) v.update(alpha, realDt, live);
    this.arena.update(realDt);
    this.referee.update(realDt, this.game, this.camState.side);
    this.effects.update(realDt * (this.game.hitStop > 0 ? 0.15 : this.replay ? 0.4 : this.game.slowmo));
    if (this.replay) this.updateReplay(realDt);
    else this.updateCamera(realDt);
    this.renderer.render(this.scene, this.camera);
  }
}
