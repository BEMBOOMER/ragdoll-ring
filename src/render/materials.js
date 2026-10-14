// Realistische materialen: geen gloed of effectshaders, alleen fysiek gebaseerde shading.
// - Een omgevingskaart van de zaal (lampenrek, tribunes, canvas) voor echte reflecties.
// - Huid met onderhuidse verstrooiing: licht dringt een stukje door en komt warm terug.
// - Gelakt leer voor handschoenen en schoenen, satijn met sheen voor broekjes.
import * as THREE from 'three';

// ---------- omgeving ----------
// Een eenvoudige zaal als bron voor reflecties: donkere ruimte, fel lampenrek boven de
// ring, tribunes die een beetje warm licht terugkaatsen en het blauwe canvas eronder.
export function arenaEnvironment(renderer) {
  const env = new THREE.Scene();
  const basic = (color, k = 1) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.BackSide });
  env.add(new THREE.Mesh(new THREE.BoxGeometry(40, 18, 40), basic(0x0d0e12)));
  const panel = new THREE.PlaneGeometry(1.4, 1.4);
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff4e6).multiplyScalar(14), side: THREE.DoubleSide });
  for (const [x, z] of [[-2, -2], [2, -2], [-2, 2], [2, 2], [0, 0]]) {
    const lamp = new THREE.Mesh(panel, lampMat);
    lamp.rotation.x = Math.PI / 2;
    lamp.position.set(x, 8.5, z);
    env.add(lamp);
  }
  // Tribunes rondom: een lage, warme band.
  const stands = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 5, 32, 1, true), basic(0x3a3229, 0.9));
  stands.position.y = 1.5;
  env.add(stands);
  const canvas = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x2a3a66).multiplyScalar(0.8) }));
  canvas.rotation.x = -Math.PI / 2;
  canvas.position.y = 0;
  env.add(canvas);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(env, 0.04);
  pmrem.dispose();
  env.traverse((o) => {
    if (o.isMesh) {
      o.geometry.dispose();
      o.material.dispose();
    }
  });
  return rt.texture;
}

// ---------- huid ----------
const LAMBERT = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );';
const SKIN_DIFFUSE = `
	// Huid: licht loopt een stukje om de schaduwgrens heen en komt rood-oranje terug.
	float skinNL = dot( geometryNormal, directLight.direction );
	float skinWrap = saturate( ( skinNL + 0.25 ) / 1.25 );
	vec3 skinScatter = vec3( 0.5, 0.14, 0.07 ) * saturate( skinWrap - saturate( skinNL ) ) * 1.6;
	reflectedLight.directDiffuse += ( skinWrap + skinScatter ) * directLight.color * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );`;
const SKIN_CHUNK = THREE.ShaderChunk.lights_physical_pars_fragment.includes(LAMBERT)
  ? THREE.ShaderChunk.lights_physical_pars_fragment.replace(LAMBERT, SKIN_DIFFUSE)
  : null;

export function skinMaterial(opts) {
  const m = new THREE.MeshPhysicalMaterial({
    roughness: 0.46,
    specularIntensity: 0.5,
    clearcoat: 0.12,
    clearcoatRoughness: 0.32,
    ...opts,
  });
  if (SKIN_CHUNK) {
    m.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_pars_fragment>', SKIN_CHUNK);
    };
    m.customProgramCacheKey = () => 'huid';
  }
  return m;
}

// Zweet: de huid wordt natter (glanzender), niet lichter.
export function setSweat(m, sweat) {
  m.roughness = 0.46 - sweat * 0.1;
  m.clearcoat = 0.12 + sweat * 0.33;
  m.clearcoatRoughness = 0.32 - sweat * 0.08;
}

// ---------- leer en stof ----------
export function leatherMaterial(opts) {
  return new THREE.MeshPhysicalMaterial({
    roughness: 0.4,
    specularIntensity: 0.6,
    clearcoat: 0.75,
    clearcoatRoughness: 0.2,
    ...opts,
  });
}

export function satinMaterial(color, opts = {}) {
  const c = new THREE.Color(color);
  return new THREE.MeshPhysicalMaterial({
    color: c,
    roughness: 0.5,
    specularIntensity: 0.35,
    sheen: 1,
    sheenRoughness: 0.32,
    sheenColor: c.clone().lerp(new THREE.Color(0xffffff), 0.45),
    ...opts,
  });
}

export function clothMaterial(color, opts = {}) {
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.92, specularIntensity: 0.2, sheen: 0.5, sheenRoughness: 0.8, sheenColor: new THREE.Color(color), ...opts });
}
