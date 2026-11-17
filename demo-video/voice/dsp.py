# Small synthesis toolkit shared by the sound-effects pack and the score. Everything is generated here: no samples.
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve

SR = 44100
rng = np.random.default_rng(7)

def t_(dur): return np.arange(int(dur * SR)) / SR
def hz(m): return 440.0 * 2 ** ((m - 69) / 12)
def lp(x, f, order=2): return sosfilt(butter(order, min(f, SR * 0.45), 'low', fs=SR, output='sos'), x)
def hp(x, f, order=2): return sosfilt(butter(order, f, 'high', fs=SR, output='sos'), x)
def bp(x, lo, hi, order=2): return sosfilt(butter(order, [lo, min(hi, SR * 0.45)], 'band', fs=SR, output='sos'), x)
def noise(dur): return rng.standard_normal(int(dur * SR))
def fade(x, a=0.003, r=0.01):
    x = x.copy(); na, nr = int(a * SR), int(r * SR)
    if na: x[:na] *= np.linspace(0, 1, na)
    if nr: x[-nr:] *= np.linspace(1, 0, nr)
    return x
def glide(f0, f1, dur, curve=1.0):
    """Phase of a tone gliding from f0 to f1 (exponential in pitch)."""
    t = t_(dur); k = (t / dur) ** curve
    f = f0 * (f1 / f0) ** k
    return 2 * np.pi * np.cumsum(f) / SR, t

def mix_into(buf, at, sig, gain=1.0, pan=0.5):
    """Add a mono (or stereo) signal into a stereo buffer at time `at` seconds."""
    i = int(at * SR)
    if i >= len(buf) or i < 0: return
    if sig.ndim == 1: sig = np.stack([sig * np.cos(pan * np.pi / 2), sig * np.sin(pan * np.pi / 2)], axis=1) * 1.2
    sig = sig[: len(buf) - i]
    buf[i : i + len(sig)] += sig * gain

_ir = None
def reverb(x, wet=0.2, decay=0.45, length=1.4):
    """A soft room: exponentially decaying filtered noise, different in each ear."""
    global _ir
    if _ir is None:
        n = int(2.0 * SR); tt = np.arange(n) / SR
        _ir = [bp(np.random.default_rng(s).standard_normal(n), 250, 7000) for s in (11, 23)]
        _ir = (tt, _ir)
    tt, irs = _ir
    n = int(length * SR)
    if x.ndim == 1: x = np.stack([x, x], axis=1)
    out = np.zeros((len(x) + n, 2))
    out[: len(x)] += x
    for c in range(2):
        ir = irs[c][:n] * np.exp(-tt[:n] / decay); ir /= np.sqrt(np.sum(ir ** 2))
        conv = fftconvolve(x[:, c], ir)[: len(out)]
        out[: len(conv), c] += wet * conv
    return out

def sweep_noise(dur, f_from, f_to, width=0.6, bands=14):
    """Noise whose colour slides from one pitch region to another (a whoosh or a riser)."""
    n = int(dur * SR); src = rng.standard_normal(n); t = np.arange(n) / n
    out = np.zeros(n)
    for k in range(bands):
        c = k / (bands - 1)
        f = f_from * (f_to / f_from) ** c
        w = np.clip(1 - np.abs(t - c) * (bands - 1) / 2.2, 0, 1)
        out += bp(src, f / (1 + width), f * (1 + width)) * w
    return out

def norm(x, peak=0.85):
    m = np.max(np.abs(x))
    return x * (peak / m) if m > 0 else x

# ---------- voices ----------
def fm_bell(f, dur=0.9, ratio=3.5, index=1.6, decay=0.35):
    t = t_(dur)
    return fade(np.sin(2 * np.pi * f * t + index * np.exp(-t / (decay * 0.6)) * np.sin(2 * np.pi * f * ratio * t)) * np.exp(-t / decay), 0.002, 0.03)
def fm_ep(f, dur=0.6, vel=1.0):
    """Electric-piano-like tone: a carrier with a quickly fading modulator at the same pitch, plus a little tine."""
    t = t_(dur)
    body = np.sin(2 * np.pi * f * t + (1.4 * vel * np.exp(-t / 0.18) + 0.25) * np.sin(2 * np.pi * f * t))
    tine = 0.12 * np.sin(2 * np.pi * f * 4 * t) * np.exp(-t / 0.05)
    return fade((body + tine) * np.exp(-t / 0.9), 0.003, 0.05)
def pop(f=520, dur=0.11):
    ph, t = glide(f * 1.9, f, 0.035)
    tail = t_(dur - 0.035)
    sig = np.concatenate([np.sin(ph), np.sin(ph[-1] + 2 * np.pi * f * tail)])
    return fade(sig * np.exp(-(np.arange(len(sig)) / SR) / 0.035), 0.001, 0.01)
def click(dur=0.02, f=3200):
    return fade(bp(noise(dur), f * 0.6, f * 1.6) * np.exp(-t_(dur) / 0.004), 0.0005, 0.004)
def kick(dur=0.38, punch=1.0):
    t = t_(dur); f = 46 + 120 * np.exp(-t / 0.032)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.15)
    return fade(np.tanh((body + 0.25 * punch * np.pad(click(0.012, 2500), (0, len(t) - int(0.012 * SR)))) * 1.6), 0.0005, 0.02)
def boom(dur=1.3):
    t = t_(dur); f = 38 + 85 * np.exp(-t / 0.09)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.42)
    thump = lp(noise(dur), 180) * np.exp(-t / 0.12) * 0.9
    return fade(np.tanh((body + thump) * 1.8), 0.001, 0.1)
