# The film's score, written against its cue sheet (raw/cues.json from cues.ts) so the music turns where the story does:
# a ticking, uneasy open that stops dead on "Who was first?", a groove from the title, a held breath for the race,
# a hit when the winner lands, a lift at "You're up!", and a final chord on the end card. All synthesised, no samples.
#   uv run --python 3.12 --with numpy --with scipy --with soundfile python voice/score.py raw/cues.json public/music.wav
import json, sys
import numpy as np
import soundfile as sf
from dsp import *

cues = json.load(open(sys.argv[1])); out = sys.argv[2]
TOTAL = cues['total']
N = int((TOTAL + 0.5) * SR)
BPM = 104.0
BEAT = 60 / BPM; STEP = BEAT / 4; BAR = BEAT * 4
SWING = 0.10

drums = np.zeros((N, 2)); bassb = np.zeros((N, 2)); keys = np.zeros((N, 2)); padb = np.zeros((N, 2)); fx = np.zeros((N, 2))
kicks = []

def put(bus, at, sig, gain=1.0, pan=0.5, cut=None):
    """Place a sound; anything still ringing at `cut` is faded out there (a break in the music)."""
    if at < 0 or (cut is not None and at >= cut - 0.004): return
    if cut is not None and at + len(sig) / SR > cut:
        sig = sig[: int((cut - at) * SR)].copy()
        k = min(len(sig), int(0.02 * SR))
        if k: sig[-k:] = (sig[-k:].T * np.linspace(1, 0, k)).T
    mix_into(bus, at, sig, gain, pan)

# ---------- kit ----------
def hat(open_=False):
    d = 0.3 if open_ else 0.06
    return fade(hp(noise(d), 7000) * np.exp(-t_(d) / (0.075 if open_ else 0.013)), 0.0005, 0.01)
def shaker():
    t = t_(0.07); return bp(noise(0.07), 5000, 10000) * np.minimum(1, t / 0.018) * np.exp(-np.maximum(0, t - 0.018) / 0.02)
def clap():
    t = t_(0.28); env = sum(np.exp(-np.maximum(0, t - d) / 0.007) * (t >= d) for d in (0, 0.011, 0.023)) * 0.5 + 0.7 * np.exp(-np.maximum(0, t - 0.03) / 0.085) * (t >= 0.03)
    return fade(bp(noise(0.28), 950, 4200) * env, 0.0005, 0.03)
def crash(d=2.4):
    return fade(lp(hp(noise(d), 3200), 12000) * np.exp(-t_(d) / 0.75), 0.002, 0.2)
def bass(f, d):
    t = t_(d); s = np.sin(2 * np.pi * f * t) + 0.5 * np.sin(4 * np.pi * f * t) + 0.2 * np.sin(6 * np.pi * f * t)
    return fade(lp(np.tanh(1.3 * s) * (0.55 + 0.45 * np.exp(-t / 0.35)), 700), 0.006, min(0.04, d / 3))
def pluck(f):
    t = t_(0.8); return fade((np.sin(2 * np.pi * f * t) + 0.3 * np.sin(4 * np.pi * f * t)) * np.exp(-t / 0.2), 0.003, 0.05)
def pad(notes, d, bright=2200):
    t = t_(d); s = np.zeros((len(t), 2))
    env = np.minimum(1, t / 0.5) * np.minimum(1, np.maximum(0, (d - t) / 0.7))
    for k, m in enumerate(notes):
        f = hz(m)
        for c, det in ((0, -0.4), (1, 0.4)):
            s[:, c] += (np.sin(2 * np.pi * (f + det) * t) + 0.3 * np.sin(4 * np.pi * (f + det) * t + 0.4 + k) + 0.12 * np.sin(6 * np.pi * f * t)) * env
    return np.stack([lp(s[:, 0], bright), lp(s[:, 1], bright)], axis=1) / len(notes)
def riser(d, top=9000, shape=2.2):
    t = t_(d); ph, _ = glide(180, 1300, d, 1.5)
    return hp(sweep_noise(d, 300, top) * (t / d) ** shape + 0.25 * np.sin(ph) * (t / d) ** (shape + 0.5), 200)
def roll(d):
    """Soft snare-like bursts getting closer together and louder."""
    b = np.zeros(int(d * SR)); at = 0.0
    while at < d - 0.03:
        k = at / d; s = bp(noise(0.05), 1200, 5000) * np.exp(-t_(0.05) / 0.012) * (0.25 + 0.75 * k)
        i = int(at * SR); s = s[: len(b) - i]; b[i : i + len(s)] += s; at += 0.16 * (1 - 0.72 * k)
    return b
def chord_ep(notes, d, vel=1.0):
    s = np.zeros((int(d * SR), 2))
    for k, m in enumerate(notes):
        mix_into(s, 0, fm_ep(hz(m), d, vel), 1.0 / len(notes) * 1.6, 0.3 + 0.4 * k / max(1, len(notes) - 1))
    return s

# ---------- harmony ----------
CH = {'F': (41, [53, 57, 60, 64]), 'Am': (45, [52, 55, 57, 60]), 'Dm': (38, [50, 53, 57, 60]), 'Bb': (46, [53, 57, 58, 62]),
      'C': (48, [52, 55, 60, 62]), 'Gm': (43, [53, 55, 58, 62]), 'A': (45, [52, 55, 57, 61])}
PROG = {'A': ['F', 'Am', 'Dm', 'Bb'], 'B': ['Dm', 'Bb', 'Gm', 'A'], 'C': ['Dm', 'Bb', 'F', 'C']}
STY = {
    'intro': dict(kick=[0, 8], clap=[], hats=1, shaker=0, ep='hold', pluck=0, bells=0, prog='A', bass=[(0, 6, 0), (8, 6, 0)]),
    'A1': dict(kick=[0, 6, 8], clap=[], hats=1, shaker=0, ep=[3], pluck=0, bells=0, prog='A', bass=[(0, 3, 0), (6, 2, 0), (8, 2, 0), (11, 1, 0), (14, 1, 12)]),
    'A2': dict(kick=[0, 6, 8], clap=[4, 12], hats=1, shaker=0, ep=[3, 10], pluck=0, bells=0, prog='A', bass=[(0, 3, 0), (6, 2, 0), (8, 2, 0), (11, 1, 0), (14, 1, 12)]),
    'A3': dict(kick=[0, 6, 8], clap=[4, 12], hats=1, shaker=1, ep=[3, 10], pluck=1, bells=0, prog='A', bass=[(0, 3, 0), (6, 2, 0), (8, 2, 0), (11, 1, 0), (14, 1, 12)]),
    'A4': dict(kick=[0, 6, 8], clap=[4, 12], hats=1, shaker=1, ep=[3, 10], pluck=1, bells=1, prog='A', bass=[(0, 3, 0), (6, 2, 0), (8, 2, 0), (11, 1, 0), (14, 1, 12)]),
    'B': dict(kick=[0, 8], clap=[12], hats=0.6, shaker=0, ep=[2, 9], pluck=0, bells=0, prog='B', bass=[(0, 6, 0), (8, 2, 0), (10, 2, 0), (14, 2, 0)]),
    'C': dict(kick=[0, 10], clap=[8], hats=0.8, shaker=1, ep='hold', pluck=0, bells=2, prog='C', bass=[(0, 7, 0), (8, 6, 0)]),
}
SCENE_STYLE = {'title': 'intro', 'setup': 'A1', 'join': 'A2', 'claim': 'A3', 'checkout': 'A3', 'race': 'A3', 'scam': 'B', 'reply': 'A2',
               'promote': 'A3', 'recap': 'A4', 'pro': 'A2', 'proof': 'C', 'end': 'A2', 'cold': 'A1'}
def scene_at(t):
    for s in cues['scenes']:
        if s['from'] <= t < s['to']: return s['id']
    return cues['scenes'][-1]['id']

def hit(at, chord='F', cut=None, big=1.0):
    """A downbeat that announces a new section: kick, cymbal, a full chord and a bell on top."""
    root, notes = CH[chord]
    put(drums, at, kick(), 1.0 * big, cut=cut); kicks.append(at)
    put(drums, at, crash(), 0.3 * big, 0.5, cut=cut)
    put(keys, at, chord_ep(notes + [notes[0] + 12], 1.6, 1.2), 0.55 * big, cut=cut)
    put(keys, at, fm_bell(hz(notes[2] + 24), 1.4, 3.5, 1.1, 0.5), 0.22 * big, 0.6, cut=cut)

def groove(t0, t1, first='F'):
    """Bars of groove from t0 (a downbeat) until t1, in the style of whichever scene each bar falls in."""
    hit(t0, first, cut=t1)
    k = 0; last_prog = None; pi = 0
    while True:
        tb = t0 + k * BAR
        if tb >= t1 - 0.08: break
        st = STY[SCENE_STYLE[scene_at(tb + 0.02)]]
        if st['prog'] != last_prog: pi = 0; last_prog = st['prog']
        root, notes = CH[PROG[st['prog']][pi % 4]]
        fill = k % 4 == 3
        at = lambda step: tb + step * STEP + (SWING * STEP if step % 2 else 0)
        for s in st['kick'] + ([14] if fill else []):
            if not (k == 0 and s == 0): put(drums, at(s), kick(), 0.95, cut=t1); kicks.append(at(s))
        for s in st['clap'] + ([15] if fill and st['clap'] else []):
            put(drums, at(s), clap(), 0.42 if s != 15 else 0.25, 0.52, cut=t1)
        for s in range(0, 16, 2):
            if k == 0 and s < 4 and st is STY['intro']: continue
            op = fill and s == 14
            put(drums, at(s), hat(op), (0.2 if s % 4 == 0 else 0.13) * st['hats'] * (1.3 if op else 1), 0.62, cut=t1)
        if st['shaker']:
            for s in range(16): put(drums, at(s), shaker(), 0.05 if s % 4 else 0.08, 0.35, cut=t1)
        for s, ln, up in st['bass']:
            put(bassb, at(s), bass(hz(root + up), ln * STEP * 0.92), 0.55, cut=t1)
        if st['ep'] == 'hold':
            put(keys, tb, chord_ep(notes, BAR * 0.98, 0.7), 0.3, cut=t1)
        else:
            for s in st['ep']: put(keys, at(s), chord_ep(notes, STEP * 2.6, 1.0), 0.34, cut=t1)
        if st['pluck']:
            for e, o in enumerate([0, 2, 3, 2, 1, 2, 3, 2]):
                put(keys, at(e * 2), pluck(hz(notes[o] + 12)), 0.11 if e % 2 == 0 else 0.075, 0.5 + 0.3 * np.sin(e * 1.7 + k), cut=t1)
        if st['bells'] == 1:
            for s, o, up in [(0, 3, 12), (6, 2, 12), (12, 1, 24)]:
                put(keys, at(s), fm_bell(hz(notes[o] + up), 0.9, 3.5, 0.9, 0.3), 0.1, 0.7, cut=t1)
        if st['bells'] == 2:
            for s, o in [(0, 3), (3, 2), (6, 3), (11, 1)]:
                put(keys, at(s), fm_bell(hz(notes[o] + 24), 0.5, 2.0, 0.6, 0.12), 0.07, 0.3 + 0.4 * (s % 3) / 2, cut=t1)
        put(padb, tb, pad(notes + [notes[1] + 12], BAR + 0.5), 0.5, cut=t1)
        k += 1; pi += 1

# ---------- 1. cold open: a clock, and comments piling up ----------
flood, ask = cues['flood'], cues['ask']
put(padb, 0.0, pad([50, 57, 60, 64, 65], ask + 0.2, 1500), 0.5, cut=ask)
b = 0
while 0.6 + b * BEAT < flood:
    put(keys, 0.6 + b * BEAT, pop(hz(81 if b % 2 == 0 else 76), 0.06), 0.09, 0.35 + 0.3 * (b % 2), cut=ask); b += 1
at = flood; i = 0
while at < ask - 0.05:
    k = (at - flood) / (ask - flood)
    put(keys, at, pop(hz(81 + (i % 3) * 2), 0.05), 0.08 + 0.11 * k, 0.3 + 0.4 * (i % 2), cut=ask)
    put(drums, at, hat(), 0.06 + 0.12 * k, 0.6, cut=ask)
    at += BEAT / 2 * (1 - 0.7 * k); i += 1
put(fx, flood, riser(ask - flood, 7000, 2.0), 0.5, cut=ask + 0.01)
# after the stop: only a low, fading hum under "…and nobody agrees who was first"
d = cues['title'] - ask
hum = (np.sin(2 * np.pi * 73.4 * t_(d)) + 0.5 * np.sin(2 * np.pi * 110 * t_(d))) * np.exp(-t_(d) / 1.4)
put(bassb, ask + 0.05, fade(hum, 0.05, 0.3), 0.25)
put(fx, cues['title'] - 0.7, fade(hp(noise(0.7), 3000) * np.exp((t_(0.7) - 0.7) / 0.2), 0.01, 0.005), 0.16)

# ---------- 2. title → the race ----------
groove(cues['title'], cues['race'])

# ---------- 3. the race: held breath, then the hit ----------
r0, tap, res = cues['race'], cues['raceTap'], cues['raceResult']
d = tap - r0
put(fx, r0, riser(d, 9000, 1.8), 0.6, cut=tap)
put(drums, r0 + d * 0.35, roll(d * 0.65), 0.35, cut=tap)
at = r0; i = 0
while at < tap - 0.04:
    k = (at - r0) / d
    put(bassb, at, bass(hz(38), BEAT / 2 * 0.8), 0.3 + 0.3 * k, cut=tap)
    put(drums, at + BEAT / 4, hat(), 0.08 + 0.14 * k, 0.6, cut=tap); put(drums, at, hat(), 0.1 + 0.14 * k, 0.6, cut=tap)
    at += BEAT / 2; i += 1
put(padb, r0, pad([50, 57, 60, 65], d + 0.1, 1800), 0.4, cut=tap)
# slow motion: the room goes underwater
d = res - tap
tt = t_(d)
drone = (np.sin(2 * np.pi * 36.7 * tt) * 0.6 + np.sin(2 * np.pi * 73.4 * tt) + 0.4 * np.sin(2 * np.pi * 110.1 * tt)) * (0.8 + 0.2 * np.sin(2 * np.pi * 1.3 * tt))
put(bassb, tap + 0.03, fade(drone, 0.25, 0.05), 0.28, cut=res)
put(padb, tap + 0.03, pad([50, 57, 62, 65], d, 520), 0.7, cut=res)
sw = min(1.3, d - 0.1)
put(fx, res - sw, fade(hp(noise(sw), 2500) * np.exp((t_(sw) - sw) / 0.33) + 0.5 * riser(sw, 6000, 3.0), 0.01, 0.004), 0.4, cut=res)

# ---------- 4. winner → the no-show ----------
groove(res, cues['promote'])

# ---------- 5. the hold runs out: a fast clock, then the lift ----------
p0, pe = cues['promote'], cues['promoted']
d = pe - p0
put(padb, p0, pad([53, 57, 60, 64], d + 0.1, 1600), 0.45, cut=pe)
at = p0; i = 0
while at < pe - 0.03:
    k = (at - p0) / d
    put(drums, at, hat(), 0.08 + 0.16 * k, 0.4 + 0.2 * (i % 2), cut=pe)
    if i % 4 == 0: put(bassb, at, bass(hz(41), STEP * 3), 0.3 + 0.2 * k, cut=pe)
    at += STEP; i += 1
put(fx, pe - min(1.6, d), riser(min(1.6, d), 9000, 2.4), 0.5, cut=pe)
put(drums, pe - 0.9, roll(0.9), 0.3, cut=pe)

# ---------- 6. promoted → the end card ----------
e0 = cues['end']
groove(pe, e0)
put(fx, e0 - 1.2, riser(1.2, 9000, 2.6), 0.4, cut=e0)

# ---------- 7. end card: the chord that says "done" ----------
def final(at, chord, g, arp):
    root, notes = CH[chord]
    put(keys, at, chord_ep(notes + [notes[0] + 12, notes[2] + 12], 3.4, 1.1), 0.6 * g)
    put(bassb, at, bass(hz(root), 2.6), 0.5 * g)
    put(padb, at, pad(notes + [notes[1] + 12], 3.6, 2600), 0.5 * g)
    for i2, o in enumerate(arp):
        put(keys, at + 0.09 * i2, fm_bell(hz(o), 1.6, 3.5, 1.0, 0.6), 0.16 * g, 0.3 + 0.08 * i2)
put(drums, e0, kick(), 1.0); kicks.append(e0); put(drums, e0, crash(3.0), 0.34)
final(e0, 'F', 1.0, [77, 81, 84, 88, 91, 96])
final(e0 + BAR, 'Bb', 0.7, [82, 86, 89, 93])
final(e0 + 2 * BAR, 'F', 0.8, [84, 88, 93, 101])
for s in range(0, 32, 2): put(drums, e0 + s * STEP, hat(), 0.1 * (1 - s / 32), 0.6)

# ---------- mix ----------
tN = np.arange(N) / SR
duck = np.ones(N)
for k_ in kicks:
    i0 = int(k_ * SR); n = min(N - i0, int(0.35 * SR))
    if n > 0: duck[i0 : i0 + n] *= 1 - 0.32 * np.exp(-np.arange(n) / SR / 0.09)
keys_w = reverb(keys, wet=0.2, decay=0.5)[:N]
drums_w = reverb(drums, wet=0.05, decay=0.25)[:N]
fx_w = reverb(fx, wet=0.15, decay=0.5)[:N]
mix = drums_w * 0.62 + (bassb * 0.7 + padb * 0.42 + keys_w * 1.9) * duck[:, None] + fx_w * 0.5
mix = np.stack([hp(mix[:, 0], 28), hp(mix[:, 1], 28)], axis=1)
mix = np.tanh(mix * 1.1 / np.percentile(np.abs(mix), 99.9)) * 0.8
tail = int(2.5 * SR); mix[-tail:] *= np.linspace(1, 0, tail)[:, None] ** 1.5
sf.write(out, mix, SR)
def rms(a, b2): x = mix[int(a * SR) : int(b2 * SR)]; return 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-9)
for nm, bb in (('drums', drums_w * 0.62), ('bass', bassb * 0.7), ('pad', padb * 0.42), ('keys', keys_w * 1.9), ('fx', fx_w * 0.5)):
    x = bb[int(24 * SR) : int(50 * SR)]; print(f'  bus {nm:6s} {20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-9):6.1f} dB (24-50s, before master)')
print('wrote', out, f'{len(mix) / SR:.1f}s', 'kicks', len(kicks))
for s in cues['scenes']: print(f"  {s['id']:9s} {rms(s['from'], s['to']):6.1f} dB")
