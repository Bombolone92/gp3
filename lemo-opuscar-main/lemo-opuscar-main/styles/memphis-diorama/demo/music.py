"""Score for Four Seasons in Pomelo Town (45 s): one continuous piece, not split by season. All synthesized in code.
F major, 96 BPM, 2.5 s per bar; the chords cycle Bbmaj7 – C – Am7 – Dm7 (IV–V–iii–vi), one round every 10 s.
Piano arpeggios run unbroken and the melody stays on piano; the seasons only change how full the accompaniment is:
spring is piano + pad + celesta; summer adds bass and light drums; autumn lightens the drums and doubles the melody on marimba;
winter drops the drums and doubles it on music box, settling on Fmaj7.
All three season changes sound the same: the big tree squats (thump) → springs back (boing) → a rising harp run.
End card (39.3 s): a low F with a music-box F major rise under the style name and sign-off; the frame draws in at 44–45 s.
Usage (from the library root): .venv/bin/python -I styles/memphis-diorama/demo/music.py  →  demo/out/mix.wav
"""
import os
import wave
import numpy as np
from scipy import signal

ROOT = os.path.dirname(os.path.abspath(__file__))
SR, DUR = 48000, 45.0
N = int(SR * DUR)
mix = np.zeros((N, 2), np.float32)
rev = np.zeros((N, 2), np.float32)
rng = np.random.default_rng(7)


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def tt(d):
    return np.arange(int(SR * d)) / SR


def filt(x, kind, f, order=2):
    return signal.sosfilt(signal.butter(order, f, btype=kind, fs=SR, output="sos"), x).astype(np.float32)


def noise(d):
    return rng.standard_normal(int(SR * d)).astype(np.float32)


def add(sig, t, gain=1.0, pan=0.0, send=0.25):
    i = int(t * SR)
    if i >= N or i < 0:
        return
    sig = np.asarray(sig, np.float32)[:N - i] * gain
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    mix[i:i + len(sig), 0] += sig * l; mix[i:i + len(sig), 1] += sig * r
    rev[i:i + len(sig), 0] += sig * l * send; rev[i:i + len(sig), 1] += sig * r * send


# ---------- Instruments ----------
def piano(m, d=2.6, vel=0.7):
    """Additive piano: two slightly detuned strings, mild inharmonicity, fast-decaying upper partials, hammer noise."""
    f, t = mtof(m), tt(d)
    s = np.zeros_like(t)
    for n in range(1, 10):
        fn = n * f * np.sqrt(1 + 0.00035 * n * n)
        if fn > 14000:
            break
        amp = (1 / n ** 1.1) * (vel ** (0.25 * (n - 1)))
        dec = (1.9 / (1 + 0.55 * (n - 1))) * (330 / f) ** 0.35
        s += amp * (np.sin(2 * np.pi * fn * t) + 0.8 * np.sin(2 * np.pi * fn * 1.0007 * t + n)) * np.exp(-t / dec)
    s += 0.25 * vel * filt(noise(d), "bandpass", [min(f * 2, 4000), min(f * 8, 12000)]) * np.exp(-t / 0.008)
    s *= np.minimum(t / 0.0015, 1) * np.minimum((d - t) / 0.12, 1)
    return filt(s, "lowpass", 2500 + 5000 * vel) * 0.35


def celesta(m, d=1.8):
    f, t = mtof(m), tt(d)
    return (np.sin(2 * np.pi * f * t) * np.exp(-t / 0.7) + 0.25 * np.sin(2 * np.pi * f * 4 * t) * np.exp(-t / 0.12)) * np.minimum(t / 0.002, 1)


def musicbox(m, d=2.0):
    f, t = mtof(m), tt(d)
    return (np.sin(2 * np.pi * f * t) * np.exp(-t / 0.9) + 0.35 * np.sin(2 * np.pi * f * 5.95 * t) * np.exp(-t / 0.05) + 0.15 * np.sin(2 * np.pi * f * 3.01 * t) * np.exp(-t / 0.3)) * np.minimum(t / 0.001, 1)


def marimba(m, d=1.0):
    f, t = mtof(m), tt(d)
    return (np.sin(2 * np.pi * f * t) * np.exp(-t / 0.4) + 0.3 * np.sin(2 * np.pi * f * 3.93 * t) * np.exp(-t / 0.05)) * np.minimum(t / 0.002, 1)


def harp(m, d=1.6):
    f, t = mtof(m), tt(d)
    s = sum((1 / k ** 1.6) * np.sin(2 * np.pi * f * k * t) * np.exp(-t / (1.0 / k ** 0.6)) for k in range(1, 6))
    return s * np.minimum(t / 0.003, 1)


def pad(ms, d, cutoff=1100, attack=1.0):
    t = tt(d)
    s = np.zeros_like(t)
    for m in ms:
        for dt in (-0.07, 0.0, 0.07):  # three slightly detuned saws, lowpassed for warmth
            f = mtof(m) * 2 ** (dt / 12)
            s += 2 * ((f * t + rng.uniform()) % 1) - 1
    s = filt(s / (3 * len(ms)), "lowpass", cutoff, order=4)
    return s * np.minimum(t / attack, 1) * np.minimum((d - t) / attack, 1)


def bass(m, d=1.0):
    f, t = mtof(m), tt(d)
    s = np.sin(2 * np.pi * f * t) + 0.25 * np.sin(4 * np.pi * f * t) * np.exp(-t / 0.2)
    return s * np.minimum(t / 0.006, 1) * np.exp(-t / 1.2) * np.minimum((d - t) / 0.05, 1)


def kick():
    t = tt(0.3)
    return np.sin(2 * np.pi * np.cumsum(55 * (1 + 1.8 * np.exp(-t / 0.025))) / SR) * np.exp(-t / 0.11)


def brush():
    t = tt(0.25)
    return filt(noise(0.25), "bandpass", [1800, 7000]) * np.exp(-t / 0.07) * np.minimum(t / 0.01, 1)


def shaker():
    t = tt(0.07)
    return filt(noise(0.07), "highpass", 6500) * np.sin(np.pi * t / 0.07) ** 2


def chirp(f0=4200, d=0.09):
    t = tt(d)
    f = f0 * (1 + 0.35 * np.sin(np.pi * t / d))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.sin(np.pi * t / d) ** 2


def quack():
    t = tt(0.16)
    s = np.sign(np.sin(2 * np.pi * np.cumsum(520 * (1 - 0.3 * t / 0.16)) / SR))
    return filt(s, "bandpass", [600, 2400]) * np.sin(np.pi * t / 0.16) ** 0.5 * 0.5


def honk():
    t = tt(0.24)
    s = 2 * ((np.cumsum(360 * (1 - 0.12 * t / 0.24)) / SR) % 1) - 1
    return filt(s, "bandpass", [450, 1800]) * np.sin(np.pi * t / 0.24) ** 0.6


def pop():
    t = tt(0.12)
    return np.sin(2 * np.pi * np.cumsum(300 + 900 * t / 0.12) / SR) * np.exp(-t / 0.04)


def whoosh(d, lo=300, hi=2500):
    t = tt(d)
    return filt(noise(d), "bandpass", [lo, hi]) * np.sin(np.pi * t / d) ** 2


# ---------- Score ----------
BEAT = 0.625
BAR = 2.5
D0 = 1.8                    # downbeat of bar 0; season changes at 9.3 / 19.3 / 29.3 land on bars 3, 7, 11
BB, C, AM, DM, F = (46, [58, 62, 65, 69]), (48, [55, 60, 64, 67]), (45, [57, 60, 64, 67]), (50, [57, 60, 62, 65]), (41, [57, 60, 64, 65])
PROG = [BB, C, AM, DM] * 3 + [BB, C, F]
bt = lambda k, b=0.0: D0 + k * BAR + b * BEAT

# Opening: the frame draws in, pad + a harp run lead into bar 1
add(pad([53, 57, 60, 64], 2.6, 900, 1.0), 0.0, 0.10, send=0.6)
for j, m in enumerate([65, 69, 72, 76, 77, 81]):
    add(harp(m), 0.45 + j * 0.2, 0.09, pan=-0.5 + 0.2 * j, send=0.5)

# Pad: follows the chords throughout
for k, (root, ch) in enumerate(PROG):
    d = BAR + 0.9 if k < len(PROG) - 1 else DUR - bt(k)
    add(pad(ch, d, 1000 if k < 4 else 1300, 0.6), bt(k) - 0.3, 0.075, send=0.5)

# Piano arpeggios: unbroken start to end (left hand root + fifth, right hand eighths)
for k in range(-1, len(PROG)):
    root, ch = PROG[k] if k >= 0 else F
    last = k == len(PROG) - 1
    for i in range(8):
        t = bt(k, i / 2)
        if t < 0.5 or (last and i > 0):
            continue
        if i == 0:
            add(piano(root, 3.0, 0.5), t, 0.5, pan=-0.35, send=0.3)
        elif i == 4:
            add(piano(root + 7, 2.0, 0.4), t, 0.32, pan=-0.25, send=0.3)
        else:
            m = ch[[0, 1, 2, 3, 2, 1, 2, 3][i]]
            add(piano(m, 1.6, 0.35), t, 0.22 * (0.9 if i % 2 else 1.0), pan=0.1 + 0.08 * (m - 60) / 6, send=0.35)
    if last:  # final Fmaj7: rolls slowly upward
        for j, m in enumerate([53, 57, 60, 64, 65, 69, 72]):
            add(piano(m, 3.5, 0.45), bt(k, 0.5 + j * 0.5), 0.28, pan=-0.3 + 0.1 * j, send=0.5)

# Melody (piano)
A = [[(0, 77, 1.5), (1.5, 76, 0.5), (2, 74, 1), (3, 72, 1)],
     [(0, 76, 1.5), (1.5, 74, 0.5), (2, 72, 1), (3, 67, 1)],
     [(0, 72, 1), (1, 76, 1), (2, 81, 1.5), (3.5, 79, 0.5)],
     [(0, 77, 1.5), (1.5, 76, 0.5), (2, 74, 2)]]
B = [[(0, 81, 1), (1, 79, 0.5), (1.5, 77, 0.5), (2, 77, 1), (3, 79, 0.5), (3.5, 81, 0.5)],
     [(0, 79, 1.5), (1.5, 76, 0.5), (2, 72, 1), (3, 74, 0.5), (3.5, 76, 0.5)],
     [(0, 76, 1), (1, 81, 1), (2, 84, 1), (3, 81, 0.5), (3.5, 79, 0.5)],
     A[3]]
END = [(0, 69, 1), (1, 72, 1), (2, 77, 4)]
MEL = A + B + A + [A[0], A[1], END]
for k, bar in enumerate(MEL):
    for b, m, d in bar:
        t = bt(k, b)
        dur = max(d * BEAT + 0.8, 1.4) if k < 14 else 4.0
        add(piano(m, dur, 0.75), t, 0.62, pan=0.15, send=0.45)
        # doubling by season: celesta in spring; none in summer (room for drums); marimba in autumn; music box in winter
        if k < 4:
            add(celesta(m + 12, 1.6), t, 0.05, pan=0.35, send=0.5)
        elif 8 <= k < 12:
            add(marimba(m, 1.0), t, 0.07, pan=0.3, send=0.35)
        elif k >= 12:
            add(musicbox(m + 12, 2.2), t, 0.06, pan=0.35, send=0.55)

# Bass: enters in summer, long notes in winter
for k in range(4, len(PROG)):
    root, _ = PROG[k]
    if k < 12:
        for b, d in ((0, 1.4), (1.5, 0.5), (2, 1.0), (3.5, 0.5)):
            add(bass(root - 12, d), bt(k, b), 0.30 * (0.85 if b else 1.0), send=0.03)
    else:
        add(bass(root - 12, BAR if k < 14 else DUR - bt(k)), bt(k), 0.26, send=0.05)
# Soft shaker from the start; kick and brushes join in summer; lighter in autumn; gone in winter
for k in range(0, 12):
    for i in range(8):
        t = bt(k, i / 2)
        g = 0.6 if k < 4 else 1.0 if k < 8 else 0.75
        rainy = 12.3 < t < 17.6
        if k < 11 or i < 4:
            add(shaker(), t, (0.022 if i % 2 else 0.032) * g, pan=0.45, send=0.05)
        if 4 <= k < 11:
            if i in (0, 5):
                add(kick(), t, 0.22 * (0.7 if rainy else 1.0) * (0.8 if k >= 8 else 1.0), send=0.03)
            if i in (2, 6):
                add(brush(), t, 0.05 * (0.8 if k >= 8 else 1.0), pan=0.15, send=0.2)

# ---------- Season change: identical all three times ----------
for T in (9.3, 19.3, 29.3):
    tq = tt(0.25)
    add(np.sin(2 * np.pi * np.cumsum(170 - 60 * tq / 0.25) / SR) * np.exp(-tq / 0.08), T - 0.42, 0.22, send=0.2)   # squat: muffled thump
    tb_ = tt(0.5)
    boing = np.sin(2 * np.pi * np.cumsum(330 + 380 * (1 - np.exp(-tb_ / 0.06)) + 25 * np.sin(2 * np.pi * 11 * tb_) * np.exp(-tb_ / 0.2)) / SR) * np.exp(-tb_ / 0.15)
    add(boing, T, 0.10, send=0.3)                                                                               # spring back: boing
    for j, m in enumerate([62, 65, 69, 72, 74, 77, 81, 84, 86, 89]):
        add(harp(m, 1.8), T + 0.08 + j * 0.11, 0.075, pan=-0.6 + 0.13 * j, send=0.6)                            # rising harp run
    add(whoosh(2.4, 500, 4500), T, 0.035, send=0.3)

# ---------- Foley (all quiet, under the music) ----------
# Spring: swallows, ducks
for t in (1.6, 1.75, 3.9, 4.05, 4.2, 6.3, 6.45, 8.1):
    add(chirp(rng.uniform(3800, 5200), 0.08), t, 0.03, pan=rng.uniform(-0.7, 0.7), send=0.3)
add(quack(), 3.3, 0.035, pan=0.6, send=0.2); add(quack(), 3.55, 0.03, pan=0.6, send=0.2); add(quack(), 7.0, 0.03, pan=0.6, send=0.2)
# Summer: cicadas, distant thunder, passing shower, lotus opening
tc = tt(8.6)
cic = filt(noise(8.6), "bandpass", [4500, 7000]) * (0.6 + 0.4 * np.sin(2 * np.pi * 38 * tc)) * np.minimum(tc / 1.0, 1) * np.minimum((8.6 - tc) / 1.0, 1)
cic[(tc + 10.8 > 12.2) & (tc + 10.8 < 16.8)] *= 0.25
add(cic, 10.8, 0.012, pan=-0.2, send=0.1)
add(filt(noise(2.5), "lowpass", 120) * np.exp(-tt(2.5) / 0.8) * np.minimum(tt(2.5) / 0.3, 1), 11.9, 0.22, send=0.3)
tr = tt(6.0)
add(filt(noise(6.0), "bandpass", [800, 7000]) * np.minimum(tr / 0.8, 1) * np.minimum((6.0 - tr) / 1.0, 1), 12.1, 0.035, send=0.15)
for t in np.sort(rng.uniform(12.4, 17.6, 50)):
    add(np.sin(2 * np.pi * np.cumsum(np.full(1200, rng.uniform(900, 1700)) * (1 + 0.8 * np.linspace(0, 1, 1200))) / SR) * np.exp(-tt(0.025) / 0.006), t, 0.018, pan=rng.uniform(-0.8, 0.8), send=0.2)
for i in range(8):
    add(celesta([84, 86, 89, 91, 93, 96, 93, 91][i], 1.2), 16.75 + i * 0.14, 0.03, pan=0.5, send=0.5)
# Autumn: falling leaves, haystacks, geese
for t in np.sort(rng.uniform(20.8, 29.0, 18)):
    d = rng.uniform(0.25, 0.5)
    add(filt(noise(d), "bandpass", [2500, 7500]) * np.sin(np.pi * tt(d) / d) ** 2, t, 0.018, pan=rng.uniform(-0.8, 0.8), send=0.15)
for t in np.sort(rng.uniform(22.1, 27.4, 10)):
    add(pop(), t, 0.012, pan=rng.uniform(-0.6, 0.6), send=0.2)
for t, p in ((22.2, 0.6), (22.5, 0.55), (23.85, 0.3), (25.35, 0.0), (26.6, -0.3), (28.15, -0.6)):
    add(honk(), t, 0.025, pan=p, send=0.35)
# Winter: wind, snowman, windows lighting one by one (dings, all in F major pentatonic)
tw = tt(DUR - 30.3)
add(filt(noise(DUR - 30.3), "bandpass", [300, 1400]) * (0.6 + 0.4 * np.sin(2 * np.pi * 0.21 * tw)) * np.minimum(tw / 1.5, 1) * np.minimum((DUR - 30.3 - tw) / 1.5, 1), 30.3, 0.03, pan=-0.3, send=0.2)
add(pop(), 32.65, 0.02, send=0.2)
for k, t in enumerate(np.sort(rng.uniform(34.7, 38.2, 12))):
    add(celesta([84, 86, 88, 91, 93, 96][k % 6], 1.2), t, 0.025, pan=rng.uniform(-0.6, 0.6), send=0.6)

# End card (39.3 s, the downbeat after the last chord): a low F and a music-box F major rising over it
add(piano(41, 5.0, 0.4), bt(15), 0.4, pan=-0.3, send=0.4)
for j, m in enumerate([77, 81, 84, 89]):
    add(musicbox(m + 12, 3.0), bt(15) + 0.15 + j * 0.22, 0.05, pan=-0.2 + 0.15 * j, send=0.6)

# ---------- Noise floor + reverb + bus ----------
add(filt(noise(DUR), "lowpass", 500) * 0.4, 0, 0.012, send=0.0)
ir_t = tt(2.6)
ir = rng.standard_normal((len(ir_t), 2)).astype(np.float32) * np.exp(-ir_t / 0.75)[:, None]
for c in range(2):
    ir[:, c] = filt(ir[:, c], "lowpass", 5500); ir[:, c] /= np.sqrt((ir[:, c] ** 2).sum())
pre = int(0.02 * SR)
wet = np.stack([np.concatenate([np.zeros(pre, np.float32), signal.fftconvolve(rev[:, c], ir[:, c])[:N - pre]]) for c in range(2)], 1) * 0.5
out = mix + wet
ta = np.arange(N) / SR
out *= (np.minimum(ta / 0.3, 1) * np.clip((DUR - ta) / 1.2, 0, 1))[:, None]
out = np.tanh(out / np.max(np.abs(out)) * 1.2) / np.tanh(1.2) * 0.89
os.makedirs(os.path.join(ROOT, "out"), exist_ok=True)
with wave.open(os.path.join(ROOT, "out", "mix.wav"), "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((out * 32767).astype(np.int16).tobytes())
print("ok")
