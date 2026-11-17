# A quiet original bed for under the narration: warm pad chords with a soft plucked pattern. Synthesised here, no samples.
#   uv run --python 3.12 --with numpy --with soundfile python voice/music.py public/music.wav 170
import sys
import numpy as np
import soundfile as sf

out, secs = sys.argv[1], float(sys.argv[2])
sr = 44100
bpm = 92.0
beat = 60 / bpm
bar = beat * 4
n = int(secs * sr)
L = np.zeros(n); R = np.zeros(n)
hz = lambda m: 440.0 * 2 ** ((m - 69) / 12)
# Fmaj9 · Dm9 · Bbmaj9 · C6/9 (MIDI notes)
chords = [[53, 57, 60, 64, 67], [50, 53, 57, 60, 64], [46, 50, 53, 57, 60], [48, 52, 55, 57, 62]]
bass = [41, 38, 34, 36]

def add(buf, start, sig):
    i = int(start * sr)
    if i >= n: return
    sig = sig[: n - i]
    buf[i : i + len(sig)] += sig

bars = int(secs / bar) + 1
for b in range(bars):
    c = chords[b % 4]
    t = np.arange(int((bar + 1.6) * sr)) / sr
    env = np.minimum(1, t / 1.1) * np.minimum(1, np.maximum(0, (bar + 1.6 - t) / 1.5))
    for k, m in enumerate(c):
        f = hz(m)
        for det, buf in ((-0.35, L), (0.35, R)):
            s = np.sin(2 * np.pi * (f + det) * t) + 0.28 * np.sin(2 * np.pi * 2 * (f + det) * t + 0.4) + 0.08 * np.sin(2 * np.pi * 3 * f * t)
            add(buf, b * bar, s * env * 0.055 * (1 + 0.15 * np.sin(2 * np.pi * 0.18 * t + k)))
    tb = np.arange(int(bar * sr)) / sr
    eb = np.minimum(1, tb / 0.05) * np.exp(-tb / 2.2)
    sb = np.sin(2 * np.pi * hz(bass[b % 4]) * tb) * eb * 0.16
    add(L, b * bar, sb); add(R, b * bar, sb)
    if b >= 4:  # the pluck pattern joins after the cold open
        order = [0, 2, 4, 2, 3, 2, 4, 1]
        for e in range(8):
            m = c[order[e]] + 12
            tp = np.arange(int(0.9 * sr)) / sr
            p = (np.sin(2 * np.pi * hz(m) * tp) + 0.3 * np.sin(2 * np.pi * 2 * hz(m) * tp)) * np.exp(-tp / 0.22) * np.minimum(1, tp / 0.004)
            pan = 0.5 + 0.3 * np.sin(e * 1.7 + b)
            g = 0.05 * (1.0 if e % 2 == 0 else 0.7)
            add(L, b * bar + e * beat / 2, p * g * (1 - pan)); add(R, b * bar + e * beat / 2, p * g * pan)
mix = np.stack([L, R], axis=1)
mix = mix / np.max(np.abs(mix)) * 0.6
fade = int(3 * sr)
mix[-fade:] *= np.linspace(1, 0, fade)[:, None]
sf.write(out, mix, sr)
print('wrote', out, secs, 's')
