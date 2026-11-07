/**
 * An emoji picker: categories of the emoji people reach for in documents,
 * a search box that matches names and keywords, and a row of the ones used
 * most recently (kept on the device). Picking one inserts it at the caret
 * through the same path as a special character.
 *
 * Each entry is `[emoji, 'name, search keywords']`: the name (everything before
 * the first comma, or the whole string when there is none) is shown to screen
 * readers and in the tooltip; the whole string is searched.
 */

import { el, isComposing } from './dom.js';
import { openModal } from './modal.js';
import { keyboardGrids, settleGridTabs, firstGridButton } from './gridkeys.js';

export const EMOJI_CATEGORIES = [
  ['Smileys', [
    ['😀', 'grinning face, happy smile'], ['😃', 'smiley, happy joy'], ['😄', 'grinning smile, laughing happy'], ['😁', 'beaming grin'],
    ['😆', 'squinting laugh, laughing lol'], ['😅', 'sweat smile, relief'], ['🤣', 'rolling on the floor laughing, rofl'], ['😂', 'tears of joy, laughing'],
    ['🙂', 'slight smile'], ['🙃', 'upside down face, silly'], ['😉', 'wink'], ['😊', 'blush, happy warm'],
    ['😇', 'innocent, halo angel'], ['🥰', 'smiling with hearts, love adore'], ['😍', 'heart eyes, love'], ['🤩', 'star struck, excited'],
    ['😘', 'blowing a kiss, kiss'], ['😗', 'kissing'], ['😋', 'yum, tasty'], ['😛', 'tongue out, playful'],
    ['🤪', 'zany, goofy'], ['🤨', 'raised eyebrow, skeptical'], ['🧐', 'monocle, inspect'], ['🤓', 'nerd, glasses'],
    ['😎', 'cool, sunglasses'], ['🥳', 'party face, celebrate'], ['😏', 'smirk'], ['😒', 'unamused, meh'],
    ['😞', 'disappointed, sad'], ['😔', 'pensive, sad'], ['😟', 'worried'], ['😕', 'confused'],
    ['🙁', 'slight frown'], ['😣', 'persevere'], ['😖', 'confounded'], ['😫', 'tired'],
    ['😩', 'weary'], ['🥺', 'pleading, puppy eyes'], ['😢', 'crying, sad tear'], ['😭', 'sobbing, crying'],
    ['😤', 'triumph, huff'], ['😠', 'angry'], ['😡', 'rage, mad furious'], ['🤯', 'mind blown, shocked'],
    ['😳', 'flushed, embarrassed'], ['🥵', 'hot face, heat'], ['🥶', 'cold face, freezing'], ['😱', 'scream, fear'],
    ['😨', 'fearful'], ['😰', 'anxious, sweat'], ['🤔', 'thinking, hmm'], ['🤗', 'hugging'],
    ['🤭', 'giggle, oops'], ['🤫', 'shush, quiet'], ['😴', 'sleeping, zzz'], ['😌', 'relieved, calm'],
    ['😷', 'medical mask, sick'], ['🤒', 'thermometer, ill'], ['🤕', 'bandage, hurt'], ['🤮', 'vomiting, sick'],
    ['🥴', 'woozy, dizzy'], ['😵', 'dizzy face, knocked out'], ['🤠', 'cowboy'], ['🥸', 'disguise'],
  ]],
  ['Gestures and people', [
    ['👍', 'thumbs up, like yes'], ['👎', 'thumbs down, no dislike'], ['👌', 'ok hand, perfect'], ['🤌', 'pinched fingers'],
    ['✌️', 'victory hand, peace'], ['🤞', 'crossed fingers, luck'], ['🤟', 'love you gesture'], ['🤙', 'call me hand, shaka'],
    ['👈', 'pointing left'], ['👉', 'pointing right'], ['👆', 'pointing up'], ['👇', 'pointing down'],
    ['☝️', 'index pointing up'], ['✋', 'raised hand, stop'], ['🤚', 'back of hand'], ['🖐️', 'hand with fingers splayed'],
    ['👋', 'waving hand, hello hi bye'], ['🤝', 'handshake, deal'], ['👏', 'clapping hands, applause'], ['🙌', 'raising hands, praise'],
    ['🙏', 'folded hands, pray thanks please'], ['💪', 'flexed biceps, muscle strong'], ['👀', 'eyes, looking'], ['🧠', 'brain, smart'],
    ['❤️', 'red heart, love'], ['🧡', 'orange heart'], ['💛', 'yellow heart'], ['💚', 'green heart'],
    ['💙', 'blue heart'], ['💜', 'purple heart'], ['🖤', 'black heart'], ['🤍', 'white heart'],
    ['💔', 'broken heart'], ['💯', 'hundred points, perfect score'], ['👶', 'baby'], ['🧑', 'person'],
    ['👩', 'woman'], ['👨', 'man'], ['🧓', 'older person'], ['👮', 'police officer'],
    ['🕵️', 'detective, spy'], ['👷', 'construction worker'], ['🧑‍💻', 'technologist, coder developer'], ['🧑‍🏫', 'teacher'],
  ]],
  ['Nature and animals', [
    ['🐶', 'dog, puppy'], ['🐱', 'cat, kitten'], ['🐭', 'mouse'], ['🐹', 'hamster'], ['🐰', 'rabbit, bunny'],
    ['🦊', 'fox'], ['🐻', 'bear'], ['🐼', 'panda'], ['🐨', 'koala'], ['🐯', 'tiger'],
    ['🦁', 'lion'], ['🐮', 'cow'], ['🐷', 'pig'], ['🐸', 'frog'], ['🐵', 'monkey'],
    ['🐔', 'chicken'], ['🐧', 'penguin'], ['🐦', 'bird'], ['🦆', 'duck'], ['🦉', 'owl'],
    ['🐴', 'horse'], ['🦄', 'unicorn'], ['🐝', 'bee'], ['🦋', 'butterfly'], ['🐢', 'turtle'],
    ['🐠', 'tropical fish'], ['🐬', 'dolphin'], ['🐳', 'whale'], ['🌵', 'cactus'], ['🌲', 'evergreen tree'],
    ['🌳', 'deciduous tree, tree'], ['🌴', 'palm tree'], ['🌱', 'seedling, sprout'], ['🌿', 'herb, leaves'], ['☘️', 'shamrock'],
    ['🍀', 'four leaf clover, luck'], ['🌸', 'cherry blossom, flower'], ['🌹', 'rose'], ['🌻', 'sunflower'], ['🌼', 'blossom, flower'],
    ['🌷', 'tulip'], ['🌍', 'globe, earth world'], ['🌙', 'crescent moon'], ['⭐', 'star'], ['🌟', 'glowing star'],
    ['✨', 'sparkles'], ['⚡', 'lightning bolt'], ['🔥', 'fire, hot flame'], ['🌈', 'rainbow'], ['☀️', 'sun, sunny'],
    ['⛅', 'sun behind cloud'], ['☁️', 'cloud'], ['🌧️', 'rain cloud, rain'], ['❄️', 'snowflake, cold'], ['💧', 'droplet, water'],
  ]],
  ['Food and drink', [
    ['🍎', 'apple'], ['🍊', 'tangerine, orange'], ['🍋', 'lemon'], ['🍌', 'banana'], ['🍉', 'watermelon'],
    ['🍇', 'grapes'], ['🍓', 'strawberry'], ['🫐', 'blueberries'], ['🍑', 'peach'], ['🥭', 'mango'],
    ['🍍', 'pineapple'], ['🥥', 'coconut'], ['🥝', 'kiwi'], ['🍅', 'tomato'], ['🥑', 'avocado'],
    ['🥦', 'broccoli'], ['🥕', 'carrot'], ['🌽', 'corn'], ['🌶️', 'hot pepper, spicy'], ['🥐', 'croissant'],
    ['🍞', 'bread'], ['🧀', 'cheese'], ['🥚', 'egg'], ['🍳', 'fried egg, cooking'], ['🥓', 'bacon'],
    ['🍔', 'hamburger, burger'], ['🍟', 'fries'], ['🍕', 'pizza'], ['🌭', 'hot dog'], ['🌮', 'taco'],
    ['🌯', 'burrito'], ['🥗', 'salad'], ['🍜', 'ramen, noodles'], ['🍣', 'sushi'], ['🍦', 'ice cream'],
    ['🍩', 'donut'], ['🍪', 'cookie'], ['🎂', 'birthday cake'], ['🍰', 'cake slice, shortcake'], ['🍫', 'chocolate'],
    ['🍬', 'candy'], ['🍿', 'popcorn'], ['☕', 'coffee, tea hot'], ['🍵', 'green tea, tea'], ['🧋', 'bubble tea, boba'],
    ['🍺', 'beer'], ['🍷', 'wine'], ['🥂', 'clinking glasses, cheers champagne toast'], ['🍾', 'champagne bottle'], ['🥤', 'cup with straw, drink soda'],
  ]],
  ['Activities and travel', [
    ['⚽', 'soccer ball, football'], ['🏀', 'basketball'], ['🏈', 'american football'], ['⚾', 'baseball'], ['🎾', 'tennis'],
    ['🏐', 'volleyball'], ['🏉', 'rugby'], ['🎱', 'pool eight ball, billiards'], ['🏓', 'ping pong, table tennis'], ['🏸', 'badminton'],
    ['🥅', 'goal net'], ['⛳', 'golf flag'], ['🏒', 'hockey'], ['🥌', 'curling'], ['🎿', 'ski'],
    ['🏂', 'snowboard'], ['🏋️', 'weight lifting, gym'], ['🤸', 'cartwheel, gymnastics'], ['🤾', 'handball'], ['🏊', 'swimming'],
    ['🚴', 'cycling, bike'], ['🏆', 'trophy, win'], ['🥇', 'gold medal, first'], ['🥈', 'silver medal, second'], ['🥉', 'bronze medal, third'],
    ['🎯', 'bullseye, target dart'], ['🎮', 'game controller'], ['🎲', 'dice, game'], ['🎨', 'artist palette, art paint'], ['🎬', 'clapper board, movie film'],
    ['🎤', 'microphone, sing'], ['🎧', 'headphones, music'], ['🎸', 'guitar'], ['🎹', 'piano, keyboard'], ['🥁', 'drum'],
    ['🎺', 'trumpet'], ['🎻', 'violin'], ['🚗', 'car'], ['🚕', 'taxi'], ['🚌', 'bus'],
    ['🚑', 'ambulance'], ['🚓', 'police car'], ['🚒', 'fire truck'], ['🚲', 'bicycle'], ['✈️', 'airplane, plane fly'],
    ['🚀', 'rocket, launch'], ['🚁', 'helicopter'], ['⛵', 'sailboat'], ['🚢', 'ship'], ['🚂', 'train'],
    ['🗺️', 'world map'], ['🏝️', 'desert island, beach'], ['🏔️', 'snowy mountain, mountain'], ['🏕️', 'camping, tent'], ['🗽', 'statue of liberty'],
  ]],
  ['Objects and symbols', [
    ['💡', 'light bulb, idea'], ['🔦', 'flashlight'], ['🔋', 'battery'], ['🔌', 'electric plug, power'], ['💻', 'laptop, computer'],
    ['🖥️', 'desktop computer, monitor'], ['🖨️', 'printer'], ['⌨️', 'keyboard'], ['🖱️', 'computer mouse, click'], ['📱', 'mobile phone'],
    ['☎️', 'telephone'], ['📷', 'camera, photo'], ['🎥', 'movie camera, video'], ['📺', 'television, tv'], ['📻', 'radio'],
    ['⏰', 'alarm clock, time'], ['⌚', 'watch'], ['⏳', 'hourglass, time'], ['📅', 'calendar, date'], ['📌', 'pushpin, pin'],
    ['📎', 'paperclip'], ['✂️', 'scissors, cut'], ['📁', 'folder'], ['📂', 'open folder'], ['📄', 'page, document'],
    ['📝', 'memo, note write'], ['✏️', 'pencil'], ['🖊️', 'pen'], ['📖', 'open book, read'], ['📚', 'books'],
    ['🔖', 'bookmark'], ['💰', 'money bag'], ['💵', 'dollar banknote, cash money'], ['💳', 'credit card'], ['🔑', 'key'],
    ['🔒', 'locked, lock secure'], ['🔓', 'unlocked, open'], ['🔨', 'hammer'], ['🔧', 'wrench, tool'], ['⚙️', 'gear, settings'],
    ['🧲', 'magnet'], ['🔍', 'magnifying glass, search'], ['💊', 'pill, medicine'], ['🩺', 'stethoscope, health'], ['🎁', 'gift, present'],
    ['🎉', 'party popper, celebrate tada'], ['🎈', 'balloon'], ['🏳️', 'white flag'], ['🚩', 'red flag'], ['📢', 'megaphone, announce'],
    ['✅', 'check mark button, done yes'], ['❌', 'cross mark, wrong no'], ['❓', 'question mark'], ['❗', 'exclamation mark'], ['⚠️', 'warning, caution'],
    ['➕', 'plus, add'], ['➖', 'minus, subtract'], ['✔️', 'check mark, tick'], ['🔴', 'red circle'], ['🟢', 'green circle'],
    ['🔵', 'blue circle'], ['🟡', 'yellow circle'], ['⬛', 'black square'], ['⬜', 'white square'], ['💬', 'speech bubble, comment'],
  ]],
];

const RECENT_KEY = 'documents:recent-emoji';
const RECENT_MAX = 24;

/** The name of an emoji entry, for a label: the words before the first comma, or all of them. */
export function emojiName(entry) {
  const words = entry?.[1] || '';
  const name = (words.includes(',') ? words.slice(0, words.indexOf(',')) : words).trim();
  return name || entry?.[0] || '';
}

/** The name with its first letter capitalized, as a tooltip shows it. */
function emojiLabel(entry) {
  const name = emojiName(entry);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** All entries flattened, in category order. */
export function allEmoji() {
  return EMOJI_CATEGORIES.flatMap(([, list]) => list);
}

/** Entries whose keywords contain every word of the query (empty query -> []). */
export function searchEmoji(query) {
  const terms = String(query || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const seen = new Set();
  const out = [];
  for (const entry of allEmoji()) {
    const hay = entry[1].toLowerCase().replace(/,/g, ' ');
    if (terms.every((t) => hay.includes(t)) && !seen.has(entry[0])) { seen.add(entry[0]); out.push(entry); }
  }
  return out;
}

/** Recently used emoji, most recent first. */
export function recentEmoji() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((s) => typeof s === 'string').slice(0, RECENT_MAX) : [];
  } catch { return []; }
}

/** Record `char` as just used; returns the updated list. */
export function rememberEmoji(char) {
  const next = [char, ...recentEmoji().filter((c) => c !== char)].slice(0, RECENT_MAX);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  return next;
}

/** The `[emoji, keywords]` entry for a character, or `[char, char]` if unknown. */
export function entryFor(char) {
  return allEmoji().find((e) => e[0] === char) || [char, char];
}

/** openEmojiPicker({ onPick }) -> { close } */
export function openEmojiPicker({ onPick }) {
  let modal = null;
  const pick = (char) => { rememberEmoji(char); modal?.close(); onPick(char); };
  const button = (entry) => el('button.symbol.emoji', {
    type: 'button', title: emojiLabel(entry), 'aria-label': emojiLabel(entry),
    onclick: () => pick(entry[0]),
  }, entry[0]);

  const results = el('div.symbol-grid', { role: 'group', 'aria-label': 'Search results', hidden: true });
  const sections = el('div', {});

  const renderSections = () => {
    const recent = recentEmoji();
    const groups = recent.length ? [['Recently used', recent.map(entryFor)], ...EMOJI_CATEGORIES] : EMOJI_CATEGORIES;
    sections.replaceChildren(...groups.map(([title, list]) => el('section.symbol-group', {},
      el('h3', {}, title),
      el('div.symbol-grid', { role: 'group', 'aria-label': title }, list.map(button)))));
  };
  renderSections();

  const search = el('input.input', { type: 'search', placeholder: 'Search emoji', 'aria-label': 'Search emoji', autocomplete: 'off', spellcheck: false });
  const empty = el('p.muted.small', { hidden: true, style: { padding: '4px 2px' } }, 'No emoji match that search.');
  const content = el('div.emoji-picker', {}, el('div.emoji-search', {}, search), results, empty, sections);
  search.addEventListener('input', () => {
    const q = search.value.trim();
    if (!q) { results.hidden = true; empty.hidden = true; sections.hidden = false; }
    else {
      const found = searchEmoji(q);
      results.replaceChildren(...found.map(button));
      results.hidden = found.length === 0;
      empty.hidden = found.length !== 0;
      sections.hidden = true;
    }
    settleGridTabs(content);
  });
  // Enter takes the first match, as in a search box; Down moves into the grid.
  search.addEventListener('keydown', (e) => {
    if (isComposing(e) || (e.key !== 'Enter' && e.key !== 'ArrowDown')) return;
    const first = firstGridButton(content);
    if (!first || (e.key === 'Enter' && results.hidden)) return;
    e.preventDefault();
    if (e.key === 'Enter') first.click(); else first.focus();
  });
  keyboardGrids(content);
  modal = openModal({ title: 'Emoji', content, wide: true });
  // On a phone the sheet leaves the keyboard closed until the search field is tapped, like every other dialog.
  if (matchMedia('(width > 640px)').matches) setTimeout(() => search.focus(), 30);
  return modal;
}
