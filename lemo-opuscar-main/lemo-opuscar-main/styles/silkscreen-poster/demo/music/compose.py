"""compose.py · original score for "The Long Way Home": a 108 BPM waltz in F major (3/4, bar = 1.6667 s), 30 bars = 50 s.
Each ink pull lands on a beat (events.json); the glockenspiel answers only the bright accent ink.

Shape: Beijing (bars 0-5, guitar waltz) → Istanbul (6-8, darbuka joins) → Paris (8-10, accordion musette tune)
→ Buenos Aires (10-12, the bass turns syncopated) → the push into the number (13-15: instruments leave one by one, nothing after 25.0 s)
→ silence → the clamp (bar 16 beat 3, 27.78 s) → the way home (17-21, guitar in eighths, harmonica joins) → the snap (bar 22, 36.67 s,
the loudest downbeat) → home (22-29, harmonica tune, the last F chord rings out).

Instruments (all CC0): guitar_nylon, accordion, world_perc (FreePats); jazz_bass (Karoryfer Sneakybass);
glockenspiel, harmonica, snare2 taps, shaker, cajon (VCSL); sus_cymbal (VSCO 2 CE).
Run from the library root:  .venv/bin/python styles/silkscreen-poster/demo/music/compose.py   → music/score.wav (+ music/stems/)."""
import sys, os, json
HERE = os.path.dirname(os.path.abspath(__file__)); D = os.path.dirname(HERE)
ROOT = os.environ.get('LIB') or os.path.abspath(os.path.join(D, '../../..'))
sys.path.insert(0, ROOT)
import numpy as np, soundfile as sf
from core.audio import sampler as S
from core.audio.sfx import SR, add

BPM = 108; B = 60 / BPM; BAR = 3 * B
def bt(bar, beat=0.): return bar * BAR + beat * B
EV = json.load(open(os.path.join(D, 'events.json')))['ev']
def ev1(tp, **kw):
    for e in EV:
        if e['type'] == tp and all(e.get(k) == v for k, v in kw.items()): return e
TOT = 50 + 3.0
N = int(TOT * SR)
S.seed(5); rng = np.random.default_rng(5)
stem = {k: np.zeros((N, 2), np.float32) for k in ['guitar', 'melody', 'bass', 'glock', 'perc', 'squeeze', 'harp']}

def g(p, at, dur=1.6, vel=.6, gain=1., pan=0., st='guitar'):
    add(stem[st], S.note('guitar_nylon', p, dur, vel), at + rng.normal(0, .004), gain, pan)
def chord(ps, at, vel=.42, dur=.5, spread=.012, gain=1., pan=.15):
    for i, p in enumerate(ps): g(p, at + i * spread, dur, vel * (1 - .06 * i), gain, pan + .05 * i)
def bass(p, at, dur=1.0, vel=.6, gain=1.): add(stem['bass'], S.note('jazz_bass', p, dur, vel), at, gain, 0)
def glock(p, at, vel=.5, gain=1., pan=.3): add(stem['glock'], S.note('glockenspiel', p, 2.5, vel), at, gain, pan)
def brush(at, vel=.35, gain=1.): add(stem['perc'], S.hit('snare2', 'taps', vel), at, gain * .5, -.2)
def shake(at, vel=.3, up=False, gain=1.): add(stem['perc'], S.hit('shaker', 'up' if up else 'down', vel), at, gain * .35, .35)
def drum(at, var, vel=.5, gain=1., pan=-.25): add(stem['perc'], S.hit('world_perc', var, vel), at, gain, pan)
def cajon(at, vel=.6, gain=1.): add(stem['perc'], S.hit('cajon', 'bass', vel), at, gain * 1.1, 0)
def acc(p, at, dur, vel=.45, gain=1., pan=-.15): add(stem['squeeze'], S.note('accordion', p, dur, vel, attack=.03, release=.2), at - .02, gain, pan)
def harm(p, at, dur, vel=.55, gain=1., pan=.1): add(stem['harp'], S.note('harmonica', p, dur, vel, attack=.04, release=.25), at - .035, gain, pan)

# ---------------- harmony: (guitar bass, double bass, chord) per bar ----------------
F = ('F2', 'F1', ['A3', 'C4', 'F4']); Am = ('A2', 'A1', ['A3', 'C4', 'E4']); Dm = ('D3', 'D2', ['A3', 'D4', 'F4'])
Bb = ('Bb2', 'Bb1', ['Bb3', 'D4', 'F4']); C = ('C3', 'C2', ['G3', 'C4', 'E4']); A7 = ('A2', 'A1', ['G3', 'C#4', 'E4'])
Gm = ('G2', 'G1', ['G3', 'Bb3', 'D4']); C7 = ('C3', 'C2', ['G3', 'Bb3', 'E4'])
HARM = [F, Am, Dm, Bb, C, F,  Dm, A7, Gm, C7, F,  Dm, Bb, Gm, C, C,  C, F, Dm, Bb, C, C7,  F, Am, Bb, F, Dm, Bb, C, F]
CLAMP = ev1('clamp')['t']; SNAP = ev1('snap')['t']; DROP = ev1('drop')['t']
for bar, (gb, bb, ch) in enumerate(HARM):
    t0 = bt(bar)
    if 13 <= bar <= 16:                                       # the push into the number: the band leaves, one part at a time
        if bar == 13: g(gb, t0, 1.6, .55); chord(ch, t0 + B, .32); chord(ch, t0 + 2 * B, .26); bass(bb, t0, 1.2, .5)
        if bar == 14: g(gb, t0, 1.8, .45); chord(ch, t0 + B, .22); bass(bb, t0, 1.6, .42)
        if bar == 15 and t0 < DROP: g(ch[1], t0, 2.0, .3)
        if bar == 16:                                         # after the silence: the clamp, then everything comes back on beat 3
            bass('F1', CLAMP, 1.0, .85); g('F2', CLAMP, 1.2, .7); chord(['A3', 'C4', 'F4'], CLAMP + .01, .55, .5); cajon(CLAMP, .85)
        continue
    last = bar == 29
    g(gb, t0, 3.4 if last else 1.6, .62)
    if last: chord(ch, t0 + B * .5, .36, dur=3.0, spread=.06)
    elif 17 <= bar <= 21:                                     # the way home: eighth-note arpeggios (faster by subdivision, same tempo)
        arp = [ch[0], ch[1], ch[2], ch[1], ch[2], ch[1]]
        for k, p in enumerate(arp[1:], 1): g(p, t0 + k * B / 2, .45, .36 + .02 * (bar - 17))
    else:
        chord(ch, t0 + B, .40); chord(ch, t0 + 2 * B, .34)
    if bar >= 1:
        if 10 <= bar <= 12:                                   # Buenos Aires: the bass leans on the "and" of two
            bass(bb, t0, .5, .6); bass(bb, t0 + 1.5 * B, .45, .5); bass(bb, t0 + 2.5 * B, .3, .35)
        else:
            bass(bb, t0, 2.6 if last else 1.2, .6 if bar != 22 else .8)
    if bar >= 2 and not last:
        brush(t0 + B, .28 + .02 * min(bar, 6)); brush(t0 + 2 * B, .24 + .02 * min(bar, 6))
    if (3 <= bar <= 12 or 17 <= bar <= 28):
        for k in range(6): shake(t0 + k * B / 2, .2 + (.06 if k % 2 == 0 else 0), up=k % 2 == 1)
    if 6 <= bar <= 8:                                         # Istanbul: darbuka
        drum(t0, 'darbuka_doom', .55); drum(t0 + B, 'darbuka_tak', .4); drum(t0 + 1.5 * B, 'darbuka_tak', .28); drum(t0 + 2 * B, 'darbuka_tak', .4)
    if 17 <= bar <= 21: cajon(t0, .45)
    if bar >= 22 and not last: cajon(t0, .4)

# ---------------- melodies ----------------
for bar, beat, p, n in [(2, 0, 'A4', 1), (2, 1, 'F4', 1), (2, 2, 'D4', 1), (3, 0, 'D5', 2), (3, 2, 'C5', 1),
                        (4, 0, 'Bb4', 1), (4, 1, 'A4', 1), (4, 2, 'G4', 1), (5, 0, 'A4', 3),
                        (6, 0, 'A4', 1), (6, 1, 'Bb4', 1), (6, 2, 'A4', 1), (7, 0, 'G4', 1), (7, 1, 'F4', 1), (7, 2, 'E4', 1)]:
    g(p, bt(bar, beat), n * B + .4, .48, .9, -.2, st='melody')
for bar, beat, p, n in [(8, 1, 'D5', 1), (8, 2, 'Bb4', 1), (9, 0, 'E5', 2), (9, 2, 'C5', 1), (10, 0, 'F5', 2), (10, 2, 'C5', 1),
                        (11, 0, 'D5', 1), (11, 1, 'F5', 1), (11, 2, 'A5', 1), (12, 0, 'F5', 3)]:
    acc(p, bt(bar, beat), n * B * .95, .5)
for bar in (10, 11, 12): acc('A3', bt(bar), BAR * .95, .22, pan=.2); acc('F3', bt(bar), BAR * .95, .2, pan=.2)
for bar, beat, p, n in [(19, 0, 'C5', 2), (19, 2, 'D5', 1), (20, 0, 'E5', 2), (20, 2, 'G5', 1), (21, 0, 'E5', 3),
                        (22, 0, 'F5', 2), (22, 2, 'C5', 1), (23, 0, 'E5', 1), (23, 1, 'C5', 1), (23, 2, 'A4', 1),
                        (24, 0, 'D5', 2), (24, 2, 'Bb4', 1), (25, 0, 'A4', 3), (26, 0, 'F4', 1), (26, 1, 'A4', 1), (26, 2, 'D5', 1),
                        (27, 0, 'D5', 2), (27, 2, 'C5', 1), (28, 0, 'Bb4', 1), (28, 1, 'A4', 1), (28, 2, 'G4', 1), (29, 0, 'F4', 5)]:
    harm(p, bt(bar, beat), n * B * .95, .5 if bar < 22 else .58)
for bar in range(22, 29): acc(HARM[bar][2][0][:-1] + '3', bt(bar), BAR * .95, .16, pan=-.3)

# ---------------- accents ----------------
glock('F6', 0.0, .55); glock('C6', 0.0, .35)                                         # the first sound: the sun
for e in EV:
    if e['type'] == 'pull' and e.get('layer') == 'acc': glock('A5', e['t'], .32)
    if e['type'] == 'item' and e.get('accent'): glock('F6', e['t'], .42); glock('A5', e['t'] + .01, .22)
add(stem['perc'], S.hit('sus_cymbal', 'hit', .55), SNAP, .7, -.2); cajon(SNAP, .95); glock('F6', SNAP, .55); glock('C6', SNAP, .4)
glock('F5', bt(29), .4); glock('A5', bt(29) + .12, .3); glock('C6', bt(29) + .24, .3)

mix = stem['guitar'] * 1.0 + stem['melody'] * .8 + stem['bass'] * .9 + stem['glock'] * .55 + stem['perc'] * .8 + stem['squeeze'] * .7 + stem['harp'] * .75
# hard silence before the clamp (nothing may ring into it)
a, b = int((DROP + .9) * SR), int(CLAMP * SR); mix[a:b] = 0
fo = int(.9 * SR); mix[a - fo:a] *= np.linspace(1, 0, fo)[:, None]
mix = S.room(mix, size=.35, mix=.16)
mix[int((DROP + 1.6) * SR):b] = 0
pk = np.abs(mix).max(); mix = mix / pk * .8
os.makedirs(os.path.join(HERE, 'stems'), exist_ok=True)
for k, v in stem.items(): sf.write(os.path.join(HERE, 'stems', k + '.wav'), v, SR)
sf.write(os.path.join(HERE, 'score.wav'), mix.astype(np.float32), SR)
print('score.wav', f'{TOT:.2f}s')
