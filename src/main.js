// Opstart en hoofdlus: koppelt physics, weergave, geluid, invoer en menu's.
import R from '@dimforge/rapier3d-compat';
import { Game } from './game/match.js';
import { AIController } from './game/ai.js';
import { Renderer } from './render/renderer.js';
import { AudioEngine } from './audio.js';
import { Input, PlayerController } from './input.js';
import { UI } from './ui.js';
import { load } from './storage.js';

const DEFAULT_SETTINGS = { master: 0.8, sfx: 0.9, crowd: 0.6, shake: true, numbers: true, muted: false, difficulty: 'normal' };

function fatal(text) {
  document.getElementById('loading').hidden = true;
  document.getElementById('fatal-text').textContent = text;
  document.getElementById('fatal').hidden = false;
}

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

async function boot() {
  if (!webglAvailable()) {
    fatal('Je browser ondersteunt geen WebGL. Probeer een recente versie van Chrome, Edge, Firefox of Safari.');
    return;
  }
  try {
    await R.init();
  } catch (err) {
    console.error(err);
    fatal('De physics-engine kon niet laden. Ververs de pagina om het opnieuw te proberen.');
    return;
  }

  const settings = { ...DEFAULT_SETTINGS, ...(load('rr-settings') || {}) };
  const canvas = document.getElementById('scene');
  const game = new Game(R);
  let renderer;
  try {
    renderer = new Renderer(canvas, game);
  } catch (err) {
    console.error(err);
    fatal('De 3D-weergave kon niet starten (WebGL-fout).');
    return;
  }
  renderer.shakeEnabled = settings.shake;
  const audio = new AudioEngine();
  audio.setVolumes({ master: settings.master, sfx: settings.sfx, crowd: settings.crowd });
  audio.setMuted(settings.muted);
  const input = new Input();
  input.bindMouse(canvas);
  const player = new PlayerController(input, () => renderer.basis());
  const cpu = new AIController(settings.difficulty);
  const demo = [new AIController('easy'), new AIController('easy')];

  const actions = {
    play() {
      audio.unlock();
      cpu.setDifficulty(settings.difficulty);
      cpu.reset();
      game.setController(0, player);
      game.setController(1, cpu);
      game.startMatch();
      renderer.mode = 'fight';
      renderer.rebuildFighters();
      ui.hideAll();
      ui.clearAnnounce();
      ui.showHud(true);
      input.enabled = true;
      input.down.clear();
      input.pressed.length = 0;
      canvas.focus();
    },
    pause() {
      if (game.mode !== 'match' || game.state === 'matchEnd') return;
      game.paused = true;
      input.enabled = false;
      input.down.clear();
      input.pressed.length = 0;
      ui.show('pause', { push: false });
    },
    resume() {
      game.paused = false;
      ui.hideAll();
      input.enabled = true;
      input.down.clear();
      input.pressed.length = 0;
      canvas.focus();
    },
    quit() {
      game.paused = false;
      input.enabled = false;
      toMenu();
    },
  };

  const ui = new UI({ game, input, audio, renderer, settings, actions });

  function toMenu() {
    demo.forEach((d) => d.reset());
    game.setController(0, demo[0]);
    game.setController(1, demo[1]);
    game.startDemo();
    renderer.mode = 'menu';
    renderer.rebuildFighters();
    ui.showHud(false);
    ui.clearAnnounce();
    ui.hideAll();
    ui.show('menu', { push: false });
  }

  input.on('gamepad', (g) => ui.toast(g.connected ? 'Gamepad verbonden' : 'Gamepad losgekoppeld'));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.mode === 'match' && !game.paused && game.state !== 'matchEnd') actions.pause();
  });
  window.addEventListener('blur', () => {
    if (game.mode === 'match' && !game.paused && game.state !== 'matchEnd' && game.state !== 'intro') actions.pause();
  });
  // Eerste interactie ontgrendelt het geluid.
  window.addEventListener('pointerdown', () => audio.unlock(), { once: true });

  function handleEvents() {
    const inMatch = game.mode === 'match';
    for (const e of game.drainEvents()) {
      renderer.onEvent(e);
      ui.onEvent(e);
      switch (e.type) {
        case 'hit':
          if (!inMatch) break;
          if (e.blocked) audio.block(e.damage);
          else audio.punchHit(e.damage, e.zone, e.ko);
          if (e.ko) {
            audio.koRoar();
            setTimeout(() => audio.bell(3), 700);
          }
          break;
        case 'whoosh':
          if (inMatch) audio.whoosh(e.name);
          break;
        case 'step':
          if (inMatch) audio.step();
          break;
        case 'countdown':
          if (e.n <= 2) audio.countdown(e.n);
          break;
        case 'fight':
          audio.fight();
          break;
        case 'timeUp':
          audio.bell(3);
          audio.cheer(0.5);
          break;
        case 'matchEnd':
          audio.cheer(1);
          break;
        default:
          break;
      }
    }
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const pad = input.readPad();
    player.pad = input.enabled ? pad : null;
    if (pad) {
      if (pad.start) {
        if (game.mode === 'match' && !game.paused && !ui.current) actions.pause();
        else if (ui.current === 'pause') actions.resume();
      }
      if (ui.current) ui.padNav(pad);
    }
    game.step(dt);
    handleEvents();
    renderer.render(dt);
    ui.updateHud(dt);
    requestAnimationFrame(frame);
  }

  // Testhaak voor geautomatiseerde browsertests.
  window.__game = { game, actions, ui, renderer, audio, input, settings };

  document.getElementById('loading').hidden = true;
  toMenu();
  requestAnimationFrame((t) => {
    last = t;
    frame(t);
  });

  if (matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches) {
    document.getElementById('menu-footnote').textContent = 'Ragdoll Ring speel je met een toetsenbord of gamepad.';
  }
}

boot();
