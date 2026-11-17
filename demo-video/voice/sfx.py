# The film's sound effects, synthesised: short, soft UI sounds that sit under a voice.
#   uv run --python 3.12 --with numpy --with scipy --with soundfile python voice/sfx.py public/sfx
import os, sys
import numpy as np
import soundfile as sf
from dsp import *

out = sys.argv[1]; os.makedirs(out, exist_ok=True)
def save(name, sig, peak=0.8, wet=0.0):
    if wet: sig = reverb(sig, wet=wet)
    if sig.ndim == 1: sig = np.stack([sig, sig], axis=1)
    sig = norm(sig, peak)
    sf.write(os.path.join(out, name + '.wav'), sig, SR)
    print(f'{name:10s} {len(sig) / SR:5.2f}s')
def seq(dur): return np.zeros((int(dur * SR), 2))

# pops at three pitches (a rising triad for "One link. One tap. One winner.")
for i, m in enumerate([72, 76, 79]): save(f'pop{i + 1}', pop(hz(m)), 0.8, wet=0.08)
save('pop', pop(hz(74)), 0.8, wet=0.06)
save('tick', click(0.03, 4200), 0.7)

# a scene-change whoosh: noise that opens up and closes again
w = sweep_noise(0.55, 350, 5200) * np.hanning(int(0.55 * SR)) ** 1.5
save('whoosh', w, 0.7, wet=0.1)

# the comment flood: forty little blips climbing in pitch, tumbling over each other
b = seq(1.75)
for i in range(40):
    m = 67 + [0, 2, 4, 7, 9][i % 5] + 12 * (i // 15)
    mix_into(b, i * (1.25 / 40), pop(hz(m), 0.09), 0.5 + 0.5 * i / 40, pan=0.2 + 0.6 * ((i * 37) % 10) / 9)
save('flood', b, 0.8, wet=0.12)

# "Who was first?": everything stops on a low thud
save('boom', boom(), 0.9, wet=0.15)
save('thud', boom(0.5) * np.exp(-t_(0.5) / 0.12), 0.85)

# a tap on glass, and the three near-simultaneous taps of the race
tap = fade(np.sin(2 * np.pi * 1850 * t_(0.05)) * np.exp(-t_(0.05) / 0.008) + 0.6 * np.pad(click(0.02, 5200), (0, int(0.03 * SR))), 0.0005, 0.01)
save('tap', tap, 0.7)
b = seq(0.5)
for i, (dt, pan) in enumerate([(0, 0.25), (0.05, 0.5), (0.1, 0.75)]): mix_into(b, dt, tap, 1.0, pan)
save('taps3', b, 0.8, wet=0.1)

# time slowing down: a tone and its air sinking away
ph, t = glide(520, 58, 1.1, 0.7)
slow = np.sin(ph) * (1 - t / 1.1) ** 0.6 * (0.75 + 0.25 * np.sin(2 * np.pi * 9 * t)) + 0.5 * sweep_noise(1.1, 3500, 220) * (1 - t / 1.1)
save('slowdown', fade(slow, 0.01, 0.2), 0.75, wet=0.2)

# winning: three bells climbing a major chord
b = seq(1.6)
for i, m in enumerate([84, 88, 91]): mix_into(b, i * 0.075, fm_bell(hz(m), 1.1, 3.5, 1.2, 0.4), 1.0, 0.35 + 0.15 * i)
save('win', b, 0.8, wet=0.25)
# promoted ("You're up!"): a brighter four-note run with a held top note
b = seq(2.2)
for i, m in enumerate([79, 84, 88, 96]): mix_into(b, i * 0.085, fm_bell(hz(m), 1.5 if i == 3 else 0.9, 3.5, 1.3, 0.55 if i == 3 else 0.35), 1.0, 0.3 + 0.13 * i)
save('fanfare', b, 0.8, wet=0.28)
# a single soft bell for small confirmations
save('ding', fm_bell(hz(88), 1.0, 3.5, 1.0, 0.4), 0.75, wet=0.22)

# money: a short shake of coins, then two bright metallic rings
b = seq(1.1)
mix_into(b, 0.0, bp(noise(0.07), 3500, 9000) * np.exp(-t_(0.07) / 0.02), 0.5)
for dt, f in [(0.07, 2093), (0.16, 2794)]:
    mix_into(b, dt, fm_bell(f, 0.8, 5.4, 2.2, 0.28) + 0.5 * fm_bell(f * 2.76, 0.8, 1.0, 0.0, 0.12), 0.9, 0.5)
save('coin', b, 0.75, wet=0.18)

# sparkle: a scatter of high bells
b = seq(1.2)
for i in range(7): mix_into(b, 0.02 + i * 0.07 + 0.02 * ((i * 13) % 3), fm_bell(hz([91, 96, 98, 103, 100, 105, 108][i]), 0.5, 3.5, 0.8, 0.16), 0.6, ((i * 5) % 7) / 6)
save('sparkle', b, 0.65, wet=0.3)

# refused: two low, dull notes stepping down (soft, not a game-show buzzer)
b = seq(0.45)
for dt, f in [(0, 196), (0.13, 156)]:
    t = t_(0.12); mix_into(b, dt, fade(lp(np.sign(np.sin(2 * np.pi * f * t)) * 0.6 + np.sin(2 * np.pi * f * t), 900), 0.004, 0.03), 1.0)
save('denied', b, 0.7, wet=0.08)

# a message leaving: a short upward bloop
ph, t = glide(480, 920, 0.11)
save('bloop', fade(np.sin(ph) * np.exp(-t / 0.09), 0.003, 0.02), 0.7, wet=0.1)

# a clock running fast (time-lapse), speeding up
b = seq(2.5); at = 0.0; i = 0
while at < 2.3:
    mix_into(b, at, click(0.025, 2600 if i % 2 else 3400), 0.5 + 0.5 * at / 2.3, 0.4 + 0.2 * (i % 2)); at += 0.12 * (1 - 0.6 * at / 2.3); i += 1
save('ticks', b, 0.7, wet=0.06)

# typing a command, and a run of check marks printing
b = seq(0.9); at = 0.0
for i in range(13):
    mix_into(b, at, click(0.02, 2200 + 900 * ((i * 7) % 5) / 4), 0.6 + 0.4 * ((i * 3) % 4) / 3, 0.45 + 0.1 * (i % 2)); at += 0.045 + 0.02 * ((i * 11) % 3)
save('typing', b, 0.6)
b = seq(1.7)
for i in range(14): mix_into(b, i * 0.105, pop(hz(76 + [0, 2, 4, 7][i % 4] + (12 if i > 9 else 0)), 0.07), 0.6, 0.5)
save('checks', b, 0.6, wet=0.08)

# ten feature chips popping in, climbing a scale
b = seq(1.5)
for i, m in enumerate([72, 74, 76, 79, 81, 84, 86, 88, 91, 93]): mix_into(b, i * 0.1, pop(hz(m), 0.1), 0.8, 0.2 + 0.06 * i)
save('chips', b, 0.75, wet=0.12)
