import { tiltFor } from './card-tilt.js';
import cardmeisterUrl from '../vendor/cardmeister.js?url';

// The vendored file registers its <playing-card> custom element by reading
// document.currentScript.src (to support an optional ?name= override of the
// tag name). document.currentScript is always null inside an ES module, so
// loading this with a plain `import` throws immediately, in every browser,
// the instant cardview.js is imported. Loading it as a real classic
// <script src> instead gives it a genuine currentScript to read. Elements
// created before this finishes loading are upgraded automatically the
// moment customElements.define() runs — that's a platform guarantee, not
// something this file has to orchestrate.
//
// Deferred until the first rich-mode face is actually built (rather than
// run at import time) so merely importing cardEl — e.g. from drag.js, which
// pulls it in for the drag ghost but is exercised by tests that never
// touch a DOM — never requires a document to exist.
let cardmeisterRequested = false;
function ensureCardmeister() {
  if (cardmeisterRequested) return;
  cardmeisterRequested = true;
  const script = document.createElement('script');
  script.src = cardmeisterUrl;
  document.head.appendChild(script);
}

// Starts the cardmeister download immediately at boot instead of waiting for
// the first rich-face build mid-render, so the opening deal doesn't paint as
// unstyled <playing-card> tags for one script round-trip (the CSS keys off
// tag presence via :has(playing-card), which matches before the custom
// element upgrades). Call this from main.js, which tests never import — kept
// DOM-guarded anyway since it's the exported, reusable entry point.
export function preloadCardmeister() {
  if (typeof document === 'undefined') return;
  ensureCardmeister();
}

// Simple mode is the small-screen card: top-left rank and suit, nothing
// else — no bottom-right corner, no centre suit. Those two used to be built
// here and hidden with CSS scoped to #board, which only ever matched inside
// the board — the drag ghost and win-celebration clones render outside it
// (appended to document.body), so they showed the extra pips this mode is
// supposed to never have. Building only the one corner removes the
// possibility entirely instead of relying on scoped CSS to hide the rest.
function buildSimpleFace(el, card) {
  const tl = document.createElement('div');
  tl.className = 'corner tl';
  tl.innerHTML = `<div class="rank">${card.rank}</div><div class="suit">${card.suit}</div>`;
  el.append(tl);
}

// The vendored element uses S H D C suit letters and 10 (or T) for ten.
const CID_SUIT = { '♠': 'S', '♥': 'H', '♦': 'D', '♣': 'C' };

function cidFor(card) {
  return card.rank + CID_SUIT[card.suit];
}

// base.css defines --card-bg and --back-color as the design tokens for these
// two colours; read them once and cache rather than hardcoding the hex
// values a second time here (and re-reading getComputedStyle on every one
// of 52 cards per render).
let richBorderColor = null;
let richBackColor = null;
function ensureColorTokens() {
  if (richBorderColor !== null) return;
  const style = getComputedStyle(document.documentElement);
  richBorderColor = style.getPropertyValue('--card-bg').trim();
  richBackColor = style.getPropertyValue('--back-color').trim();
}

function buildRichFace(el, card) {
  ensureCardmeister();
  ensureColorTokens();
  const pc = document.createElement('playing-card');
  pc.setAttribute('cid', cidFor(card));
  // Its own border cannot be turned off with borderline=0; matching it to the
  // card colour hides it so our wrapper draws the only visible edge.
  pc.setAttribute('bordercolor', richBorderColor);
  el.appendChild(pc);
}

function buildRichBack(el) {
  ensureCardmeister();
  ensureColorTokens();
  const pc = document.createElement('playing-card');
  pc.setAttribute('cid', 'back');
  pc.setAttribute('backcolor', richBackColor);
  el.appendChild(pc);
}

// Single code path for building a card's visible content, shared by cardEl
// (the pile-rendered card) and animate.js (the flip/flight/celebration
// faces), so rich and simple mode can never drift between the two.
export function renderFaceInto(el, card, mode = 'simple') {
  if (mode === 'rich') {
    if (card.faceUp) buildRichFace(el, card);
    else buildRichBack(el);
  } else if (card.faceUp) {
    buildSimpleFace(el, card);
  }
}

export function cardEl(card, mode = 'simple') {
  const el = document.createElement('div');
  el.className = 'card ' + (card.faceUp ? 'face-up ' + card.color : 'face-down');
  el.dataset.id = card.id;
  el.style.setProperty('--card-tilt', tiltFor(card.id) + 'deg');
  renderFaceInto(el, card, mode);
  return el;
}

// Inline SVGs, not a Material Symbols web font: the font's stylesheet is
// fetched cross-origin from fonts.googleapis.com, which the service worker
// deliberately never caches (see public/sw.js) -- so offline more than a day
// or so after the last online visit, that stylesheet 404s and every
// ligature span used to render as its own literal source text ("star",
// "refresh"...). currentColor makes each icon inherit .slot's own colour,
// same as the ligature font did.
const ICONS = {
  refresh: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 15.3-6.4L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.3 6.4L3 16"/><path d="M3 21v-5h5"/></svg>',
  block: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><line x1="5.5" y1="5.5" x2="18.5" y2="18.5"/></svg>',
  star: '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.6 5.9 6.4.6-4.9 4.4 1.4 6.3L12 17l-5.5 3.2 1.4-6.3-4.9-4.4 6.4-.6z"/></svg>',
};

export function slotEl(iconName) {
  const slot = document.createElement('div');
  slot.className = 'slot';
  if (iconName && ICONS[iconName]) {
    slot.innerHTML = ICONS[iconName];
  }
  return slot;
}
