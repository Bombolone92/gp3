// The one take for 叮之前: [t, target (Vector3 | subject), dist, az, el, fov, target offset?, {ease}?] and impact shakes [t, amp, decay].
// Film seconds. az 0 = camera on the +z side looking toward −z (screens and cards read upright); el in radians.
import { VO, CREDIT_T, DUR } from './vo.js';
const R = { ease: 1 };
export const KEYS = [
  // S1 your phone and the title; the cat pops; send; whip to the friend's phone, where it seems to arrive at once
  [0.0, 'Atent', .66, .42, .58, 34],
  [1.2, 'Atent', .62, .36, .6, 34],
  [2.95, 'Atent', .6, .3, .62, 34, null, R],
  [3.15, 'wide', 1.25, .05, .78, 35],   // the whip arcs up over the desk, so the route and the stops pass through frame, not bare paper
  [3.35, 'B', .6, -.25, .72, 35],
  [4.5, 'B', .58, -.2, .74, 35, null, R],
  // S2 rise over the desk: not a straight line, but a route through two stops
  [5.7, 'wide', 2.35, .0, 1.0, 36],
  [7.35, 'wide', 2.33, .02, 1.0, 36, null, R],
  // S3 back to the cat; it leaps to the compress card (the whip rides the leap)
  [7.9, 'cat', .5, .3, .52, 36],
  [8.35, 'cat', .5, .28, .52, 36, null, R],
  [8.85, 'cmp', .55, -.05, .72, 36],
  [10.3, 'cmp', .52, -.02, .78, 36, null, R],
  // S4 the press, the counter, original ≈ compressed
  [11.2, 'cmp', .6, .0, .95, 36],
  [16.9, 'cmp', .57, .05, .97, 36, null, R],
  // S5 ride the hops to the server
  [17.6, 'cat', .52, .35, .5, 36],
  [18.7, 'cat', .56, .4, .46, 36],
  [19.6, 'srvTop', .62, .3, .5, 36, null, R],
  // S6 half an orbit round the server; the drawer opens, the photo goes in, a window lights
  [21.4, 'srv', .64, .62, .42, 36],
  [22.9, 'srv', .74, .18, .52, 36],
  [24.4, 'srv', .68, .0, .46, 36],
  [26.0, 'srvTop', .62, -.22, .44, 36, null, R],
  // S7–S8 the bell rises, flies to the friend's phone, taps it; the banner drops
  [27.6, 'bell', .55, -.2, .4, 36],
  [28.25, 'bell', .56, -.18, .42, 36, null, R],
  [29.0, 'Btop', .7, -.15, .7, 36],
  [30.5, 'Btop', .62, -.1, .9, 36],
  [32.0, 'Btop', .6, -.05, .98, 36, null, R],
  // S9 the ring
  [34.5, 'Btop', .58, -.04, 1.0, 36, null, R],
  // S10 the phone goes to the server: pull out to see both, the route lights back to the server, the photo hops home
  [35.6, 'leg2', 1.2, -.1, .75, 36],
  [37.3, 'leg2', 1.15, -.15, .74, 36],
  [38.4, 'cat', .62, -.3, .55, 36],
  // S11 slow connection: blurry, then sharp
  [39.9, 'Bbubble', .5, -.05, .95, 36],
  [44.8, 'Bbubble', .47, -.02, .98, 36, null, R],
  // S12 the whole relay
  [46.5, 'wide', 2.4, .06, 1.05, 36],
  [48.3, 'wide', 2.37, .07, 1.05, 36, null, R],
  // S13 the friend's copy; S14 your original
  [49.0, 'Bbubble', .46, -.05, 1.0, 36],
  [VO[13].t0 + .2, 'Bbubble', .45, -.04, 1.0, 36, null, R],
  [VO[13].t0 + .4, 'wide', 1.3, .03, .95, 36],
  [VO[13].t0 + .6, 'Aalbum', .6, .05, 1.0, 36],
  [CREDIT_T - .25, 'Aalbum', .58, .07, 1.0, 36, null, R],
  // S15 the closing shot: one long rise and pull-back until all four stops and the relay line are in frame; everything hops once, the cats bow
  [CREDIT_T + .55, 'final', 2.55, .22, 1.02, 36],
  [DUR, 'final', 2.62, .3, 1.04, 36],
];
export const SHAKES = [[2.25, .002, 10], [10.5, .006, 8], [33.5, .004, 9]];
