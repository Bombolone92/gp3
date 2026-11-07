// One continuous camera. Target keys may name a live subject (ctx.subj[name](t)); orbit keys are [log dist, azimuth, elevation, fov].
// Between target keys: Hermite with live end points, so the camera keeps tracking moving subjects while it travels.
// keys: [t, target (Vector3 | subject name), dist, az, el, fov, target offset?, {ease}?]
//   ease: the target comes to rest at this key (zero tangent), so a whip that starts here doesn't first drift backwards
// shakes: [t, amplitude (world units), decay]
import * as THREE from 'three';
import { track, vnoise, clamp } from '/core/lib.js';
import { V } from './anim.js';

const ln = Math.log;
export function makeRig(ctx, camera, KEYS, SHAKES) {
  const keys = KEYS.map(k => ({ t: k[0], tg: k[1], off: k[6], ease: k[7]?.ease }));
  const orb = track(KEYS.map(k => [k[0], [ln(k[2]), k[3], k[4], k[5]]]));
  const ev = (k, t) => typeof k.tg === 'string' ? ctx.subj[k.tg](t).clone().add(k.off || V(0, 0, 0)) : k.tg.clone();
  function target(t) {
    const n = keys.length; if (t <= keys[0].t) return ev(keys[0], t); if (t >= keys[n - 1].t) return ev(keys[n - 1], t);
    let i = 0; while (t > keys[i + 1].t) i++;
    const a = keys[i], b = keys[i + 1], h = b.t - a.t, u = (t - a.t) / h;
    const pa = ev(a, t), pb = ev(b, t);
    const tan = j => { const p = keys[Math.max(0, j - 1)], q = keys[Math.min(n - 1, j + 1)]; if (p === q || keys[j].ease) return V(0, 0, 0); return ev(q, t).sub(ev(p, t)).multiplyScalar(1 / (q.t - p.t)); };
    const ma = tan(i).multiplyScalar(h * .85), mb = tan(i + 1).multiplyScalar(h * .85);
    const u2 = u * u, u3 = u2 * u;
    return pa.multiplyScalar(2 * u3 - 3 * u2 + 1).add(ma.multiplyScalar(u3 - 2 * u2 + u)).add(pb.multiplyScalar(-2 * u3 + 3 * u2)).add(mb.multiplyScalar(u3 - u2));
  }
  const tmp = new THREE.Vector3();
  function apply(t, jx = 0, jy = 0) {
    const tg = target(t), [ld, az, el, fov] = orb(t), d = Math.exp(ld);
    const n = k => vnoise(t * 1.3 + k * 17.3) - .5;
    const pos = tg.clone().add(V(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).multiplyScalar(d));
    pos.add(V(n(1), n(2), n(3)).multiplyScalar(d * .006));   // a breath of drift, not a handheld wobble
    let sh = 0; for (const [ts, a, dk] of SHAKES) { const dt = t - ts; if (dt > 0 && dt < 1) sh += a * Math.exp(-dt * dk); }
    if (sh) { pos.add(V(Math.sin(t * 91), Math.sin(t * 77 + 1), Math.sin(t * 83 + 2)).multiplyScalar(sh)); tg.add(V(Math.sin(t * 67), Math.sin(t * 73), 0).multiplyScalar(sh * .5)); }
    ctx.world.scene.fog.density = .075 / Math.max(1, d * .9);
    camera.position.copy(pos); camera.fov = fov; camera.up.set(0, 1, 0); camera.lookAt(tg);
    // bank into fast lateral moves: roll ∝ the turning rate of the azimuth
    const daz = (orb(t + .05)[1] - orb(t - .05)[1]) / .1;
    camera.rotateZ(n(4) * .01 + clamp(daz * -.04, -.12, .12));
    camera.setViewOffset(1920, 1080, jx, jy + 110, 1920, 1080);   // the subject sits 110 px above centre: the subtitle bar owns the bottom of the frame camera.updateProjectionMatrix();
    return { tg, d };
  }
  return { apply, target };
}
