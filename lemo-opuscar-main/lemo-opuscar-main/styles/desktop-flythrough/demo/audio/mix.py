"""Voice-over + music + foley → one stereo mix, 48 kHz, exactly the film's length, about −16 LUFS, true peak under −1.5 dBFS.
The voice leads; the music ducks 16 dB under it and comes back up where nobody speaks; the foley sits under the voice. Usage: mix.py <score.wav> <sfx.wav> <out.wav> [sfx_gain_db]  (the voice comes from vo/ and vo/timeline.json)"""
import sys, os, wave
import numpy as np
sys.path.insert(0, os.path.join(os.environ.get('LIB', os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../../..'))), 'core/audio'))
from sfx import SR, limit

def read(p):   # any PCM width (the score is 24-bit): let ffmpeg decode to float
    import subprocess
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', p, '-f', 'f32le', '-ac', '2', '-ar', str(SR), '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, '<f4').astype(np.float64).reshape(-1, 2)
m, f = read(sys.argv[1]), read(sys.argv[2]); g = 10 ** (float(sys.argv[4] if len(sys.argv) > 4 else -3) / 20)
N = int(float(os.environ.get('DUR', 59.95)) * SR); mix = np.zeros((N, 2))
f = f[:N] * g
for c in range(2): f[:, c] = limit(f[:, c], .35)   # tame the slams so they sit in the music, not on top of it
# the voice track, placed on the film clock
import json, soundfile as sf
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TL = json.load(open(os.path.join(ROOT, 'vo/timeline.json')))['lines']; vo = np.zeros((N, 2)); act = np.zeros(N)
for l in TL:
    x, sr = sf.read(os.path.join(ROOT, os.environ.get('VO_DIR', 'vo'), l['id'] + '.wav'));   # VO_DIR=vo_en for the English mix: same start times as the Chinese lines
    if x.ndim > 1: x = x.mean(1)
    x = np.interp(np.arange(int(len(x) * SR / sr)) * sr / SR, np.arange(len(x)), x)
    s = int(l['t0'] * SR); n = min(len(x), N - s); vo[s:s + n] += x[:n, None]; act[s:s + n] = 1
# ducking envelope: −16 dB while the voice speaks (attack 0.15 s before, release 0.4 s after), 0 dB in the gaps
duck = np.ones(N); k = np.where(act > 0)[0]
from scipy.ndimage import maximum_filter1d, uniform_filter1d
a = maximum_filter1d(act, size=int(.5 * SR)); a = uniform_filter1d(a, size=int(.3 * SR)); duck = 1 - a * (1 - 10 ** (-16 / 20))
m = m[:N] if len(m) >= N else np.vstack([m, np.zeros((N - len(m), 2))])
vo *= 10 ** (-20.5 / 20) / max(1e-9, np.sqrt(np.mean(vo[act > 0] ** 2)))   # voice RMS ≈ −20.5 dBFS while speaking
mix += m * duck[:, None] * 1.75 + f * (1 - .45 * a)[:, None] + vo

fade = int(.08 * SR); mix[-fade:] *= np.linspace(1, 0, fade)[:, None]
for c in range(2): mix[:, c] = limit(mix[:, c], .8)
# bring the mix to about −16 LUFS (mux.sh lifts it to −14) and keep the peaks under −3 dBFS
def lufs(x):
    import subprocess, tempfile, re
    with tempfile.NamedTemporaryFile(suffix='.wav') as tf:
        with wave.open(tf.name, 'wb') as w: w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((np.clip(x, -1, 1) * 32767).astype('<i2').tobytes())
        err = subprocess.run(['ffmpeg', '-nostats', '-i', tf.name, '-af', 'ebur128', '-f', 'null', '-'], capture_output=True, text=True).stderr
    return float(re.findall(r'I:\s+(-?[\d.]+) LUFS', err)[-1])
for _ in range(2):
    mix *= 10 ** ((-16.0 - lufs(mix)) / 20)
    for c in range(2): mix[:, c] = limit(limit(mix[:, c], .7, .004), .72, .0015)
print('mix loudness', lufs(mix), 'LUFS')
with wave.open(sys.argv[3], 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((np.clip(mix, -1, 1) * 32767).astype('<i2').tobytes())
print('wrote', sys.argv[3], 'peak', round(np.abs(mix).max(), 3))
