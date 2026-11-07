// Shared setup for the review tests: a fake Puter with an owner (alice),
// reviewers (bob, carol) and an outsider (dave), and helpers to publish a
// review the way the share dialog does.
import { createWorld, USERS } from '../dev/fake-puter.js';
import { deploy, call } from '../src/review/api.js';

export { USERS };

export const bundleFetcher = (build = 'dev', at = 1) => async () => new Response(`/* video-studio-review-worker build=${build} at=${at} */\n(function(){})();`);

export async function setup({ start = Date.now() } = {}) {
  let clock = start;
  const world = createWorld({ now: () => clock });
  world.restartWorkers();
  const sdk = {
    alice: world.sdk(USERS.alice),
    bob: world.sdk(USERS.bob),
    carol: world.sdk(USERS.carol),
    dave: world.sdk(USERS.dave),
  };
  const server = await deploy(sdk.alice, { fetcher: bundleFetcher(), wait: async () => {} });
  const as = (who) => (op, fields = {}) => call(sdk[who], server, { op, ...fields });
  return {
    world,
    sdk,
    server,
    as,
    advance(ms) {
      clock += ms;
    },
    now: () => clock,
  };
}

let seq = 0;
/** Write a small "video" to the owner's files and publish it. */
export async function publish(env, { projectId = 'proj_000001', title = 'Cut A', duration = 10_000_000, fps = 30, range = null, clientId } = {}) {
  const blob = new Blob([new Uint8Array(4096).map((_, i) => i % 251)], { type: 'video/mp4' });
  const item = await env.sdk.alice.fs.write(`video-studio/reviews/${projectId}/v-${++seq}.mp4`, blob, { overwrite: true, createMissingParents: true });
  return env.as('alice')('review.publish', {
    clientId: clientId || `pub_${String(seq).padStart(6, '0')}`,
    projectId,
    title,
    video: { path: item.path, mime: 'video/mp4', fps, duration, width: 1280, height: 720, range },
  });
}

/** Owner creates an invite; returns its token. */
export async function invite(env, review, role = 'commenter', days = 7) {
  return (await env.as('alice')('invite.create', { review, role, days })).token;
}
