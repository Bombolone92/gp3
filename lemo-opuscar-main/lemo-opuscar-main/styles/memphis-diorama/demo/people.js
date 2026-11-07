// Distant figures: a capsule body, round head, hat, two legs and two arms. Only a walk cycle and simple poses; never close-ups.
import * as THREE from 'three';
import { flat, mesh } from './memphis.js';

const SKIN = '#FFD9B8';
const cache = new Map();
const M = (hex, o = {}) => { const k = hex + JSON.stringify(o); if (!cache.has(k)) cache.set(k, flat(hex, o)); return cache.get(k); };

export function person(world, o) {
  const g = new THREE.Group(); world.add(g);
  const body = mesh(new THREE.CapsuleGeometry(0.28, 0.55, 6, 14).translate(0, 1.05, 0), M(o.col), 0, 0, 0, g);
  const head = new THREE.Group(); head.position.set(0, 1.72, 0); g.add(head);
  mesh(new THREE.SphereGeometry(0.24, 16, 12), M(SKIN), 0, 0, 0, head);
  if (o.hat) mesh(new THREE.SphereGeometry(0.29, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), M(o.hat), 0, 0.06, 0, head);
  const legs = [-1, 1].map((s) => mesh(new THREE.CapsuleGeometry(0.09, 0.42, 4, 8).translate(0, -0.3, 0), M('#4A4468'), 0, 0.62, s * 0.13, g));
  const arms = [-1, 1].map((s) => {
    const a = new THREE.Group(); a.position.set(0, 1.36, s * 0.33); g.add(a);
    mesh(new THREE.CapsuleGeometry(0.075, 0.38, 4, 8).translate(0, -0.25, 0), M(o.col), 0, 0, 0, a);
    mesh(new THREE.SphereGeometry(0.085, 10, 8), M(SKIN), 0, -0.5, 0, a);
    return a;
  });
  return { g, body, head, legs, arms, ...o };
}

// Lay a unit-length, y-aligned cylinder between two points (a kite string)
const _up = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3();
export function limb(m, a, b) {
  _d.subVectors(b, a); const len = _d.length();
  m.position.copy(a).addScaledVector(_d, 0.5); m.quaternion.setFromUnitVectors(_up, _d.normalize()); m.scale.set(1, Math.max(len, 1e-3), 1);
}

// Walk cycle: bob, sway, legs and arms swing; ph is the step phase
export function walk(p, x, z, a, ph) {
  p.g.position.set(x, 0.15 + Math.abs(Math.sin(ph)) * 0.08, z); p.g.rotation.y = -a;
  p.body.rotation.z = Math.sin(ph) * 0.06; p.head.position.y = 1.72 + Math.abs(Math.cos(ph)) * 0.03;
  p.legs[0].rotation.z = Math.sin(ph) * 0.5; p.legs[1].rotation.z = -Math.sin(ph) * 0.5;
  p.arms[0].rotation.set(0, 0, -Math.sin(ph) * 0.45); p.arms[1].rotation.set(0, 0, Math.sin(ph) * 0.45);
}
