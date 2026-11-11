"""
CONAS — FINANCIAL VELOCITY · sound design
Fully synthesized (no samples), 48 kHz stereo, 15.000 s, synchronized to the film timeline.

Layers
  - sub drone + sub-bass pulses
  - data texture: high-frequency digital clicks, data-transmission chirps
  - whooshes: number fly-bys (scene 1) and every tunnel ring passing the lens (scene 2)
  - mechanical acceleration riser into the tunnel (t = 3.0 s)
  - collision impacts on every cut (6.0 / 6.75 / 7.45 / 8.2 s)
  - convergence: rising mechanical tonal layer + ratchet (9-12 s)
  - logo: one clean cinematic impact (12.0 s), metallic lock ticks, red-streak swoosh, elegant decay

Usage: python3 tools/sound.py out.wav
"""
import sys
import wave
import numpy as np
from scipy import signal

SR = 48000
DUR = 15.0
N = int(SR * DUR)
rng = np.random.default_rng(20261111)
t_all = np.arange(N) / SR
mix = np.zeros((N, 2))


def env_adsr(n, a, d, s_level, r):
    """attack/decay/sustain/release envelope in seconds, total length n samples."""
    e = np.zeros(n)
    a_n, d_n, r_n = int(a * SR), int(d * SR), int(r * SR)
    s_n = max(0, n - a_n - d_n - r_n)
    i = 0
    seg = lambda m: max(0, min(m, n - i))
    k = seg(a_n); e[i:i + k] = np.linspace(0, 1, a_n)[:k]; i += k
    k = seg(d_n); e[i:i + k] = np.linspace(1, s_level, d_n)[:k]; i += k
    k = seg(s_n); e[i:i + k] = s_level; i += k
    k = seg(r_n); e[i:i + k] = np.linspace(s_level, 0, r_n)[:k]
    return e


def add(sig, start, gain=1.0, pan=0.0):
    """add mono or stereo signal at time `start` (s) with equal-power pan (-1..1)."""
    i0 = int(start * SR)
    if i0 >= N:
        return
    if sig.ndim == 1:
        l = np.cos((pan + 1) * np.pi / 4)
        r = np.sin((pan + 1) * np.pi / 4)
        sig = np.stack([sig * l, sig * r], axis=1)
    if i0 < 0:
        sig = sig[-i0:]
        i0 = 0
    n = min(len(sig), N - i0)
    mix[i0:i0 + n] += sig[:n] * gain


def bp(x, lo, hi, order=2):
    sos = signal.butter(order, [lo, hi], btype='band', fs=SR, output='sos')
    return signal.sosfilt(sos, x)


def lp(x, f, order=2):
    return signal.sosfilt(signal.butter(order, f, btype='low', fs=SR, output='sos'), x)


def hp(x, f, order=2):
    return signal.sosfilt(signal.butter(order, f, btype='high', fs=SR, output='sos'), x)


def sweep_filter_noise(dur, f0, f1, q=1.2, curve=1.0):
    """noise through a band-pass whose centre sweeps f0 -> f1 (processed in short blocks)."""
    n = int(dur * SR)
    x = rng.standard_normal(n)
    out = np.zeros(n)
    block = 512
    zi = None
    for b in range(0, n, block):
        u = (b / n) ** curve
        fc = f0 * (f1 / f0) ** u
        lo, hi = fc / (1 + 1 / (2 * q)), min(SR / 2 - 100, fc * (1 + 1 / (2 * q)))
        sos = signal.butter(2, [lo, hi], btype='band', fs=SR, output='sos')
        if zi is None:
            zi = np.zeros((sos.shape[0], 2))
        out[b:b + block], zi = signal.sosfilt(sos, x[b:b + block], zi=zi)
    return out


def whoosh(dur, f0, f1, peak=0.5, gain=1.0):
    """a pass-by: filtered noise swelling to `peak` (0..1 of dur) then decaying."""
    n = int(dur * SR)
    x = sweep_filter_noise(dur, f0, f1, q=0.9)
    u = np.linspace(0, 1, n)
    e = np.where(u < peak, (u / peak) ** 2.2, np.exp(-(u - peak) / (1 - peak) * 4))
    return x * e * gain / (np.max(np.abs(x * e)) + 1e-9)


def impact(dur=1.6, body=48, punch=1.0, bright=1.0):
    """deep industrial impact: pitched-down sine thump + noise crack + metallic partials."""
    n = int(dur * SR)
    tt = np.arange(n) / SR
    f = body * (1 + 2.5 * np.exp(-tt * 28))
    thump = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 3.2)
    crack = hp(rng.standard_normal(n), 1800) * np.exp(-tt * 38) * 0.6 * bright
    metal = sum(np.sin(2 * np.pi * fr * tt + rng.uniform(0, 6)) * np.exp(-tt * dk) * a
                for fr, dk, a in [(287, 6, 0.25), (433, 7, 0.18), (691, 9, 0.12), (1093, 11, 0.08), (1571, 13, 0.06)]) * bright
    s = thump * 1.0 * punch + crack + metal * 0.5
    return s / (np.max(np.abs(s)) + 1e-9)


def click(freq, dur=0.012):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    return np.sin(2 * np.pi * freq * tt) * np.exp(-tt * 420)


def metal_tick(freq=2400, dur=0.25):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    s = sum(np.sin(2 * np.pi * freq * r * tt) * np.exp(-tt * (30 + 12 * r)) / r for r in (1, 1.51, 2.37, 3.11))
    return s / np.max(np.abs(s))


def reverb(x, seconds=2.2, wet=0.25, predelay=0.012):
    """simple stereo convolution reverb with decaying noise impulse responses."""
    n = int(seconds * SR)
    tt = np.arange(n) / SR
    out = np.zeros_like(x)
    for ch in range(2):
        ir = rng.standard_normal(n) * np.exp(-tt * 6.9 / seconds)
        ir = lp(ir, 6000)
        ir[: int(predelay * SR)] = 0
        ir /= np.sqrt(np.sum(ir ** 2))
        out[:, ch] = signal.fftconvolve(x[:, ch], ir)[: len(x)]
    return x * (1 - wet) + out * wet


# ------------------------------------------------------------------ camera timing (mirrors film.js)
def cam_z(t):
    if t < 3:
        u = t / 3
        return 140 - (300 * u + 600 * u * u)
    if t < 6:
        u = (t - 3) / 3
        return -760 - (1420 * u + 700 * u ** 3)
    return None


def pass_time(z_obj, t0, t1):
    """time at which the camera crosses z_obj (bisection)."""
    a, b = t0, t1
    for _ in range(60):
        m = (a + b) / 2
        if cam_z(m) > z_obj:
            a = m
        else:
            b = m
    return (a + b) / 2


# ------------------------------------------------------------------ layers
# 1. sub drone through scenes 1-4, swelling with speed
drone_f = 36 + 10 * np.clip(t_all / 9, 0, 1)
drone = np.sin(2 * np.pi * np.cumsum(drone_f) / SR) + 0.35 * np.sin(2 * np.pi * np.cumsum(drone_f * 2.01) / SR)
drone_env = np.clip(t_all / 0.05, 0, 1) * np.where(t_all < 9, 0.55 + 0.25 * np.clip((t_all - 3) / 3, 0, 1), 0.5) * np.clip((12.0 - t_all) / 0.04, 0, 1)
add(drone * drone_env, 0, 0.22)

# 2. air / velocity bed (filtered noise that brightens with speed), cut at 9.0 (sudden calm)
bed = sweep_filter_noise(9.0, 300, 2600, q=0.6, curve=1.4)
bed_env = np.minimum(1, np.linspace(0.55, 1.3, len(bed))) * np.clip((9.0 - np.arange(len(bed)) / SR) / 0.06, 0, 1)
add(np.stack([bed * bed_env, np.roll(bed, 211) * bed_env], axis=1), 0, 0.09)

# 3. digital data texture: clicks + transmission chirps (dense in 0-9, sparse in 9-12)
for _ in range(520):
    tc = rng.uniform(0, 11.8)
    if tc > 9 and rng.random() < 0.5:
        continue
    add(click(rng.choice([3200, 4100, 5300, 6800, 8200, 9600])), tc, rng.uniform(0.02, 0.06), rng.uniform(-0.9, 0.9))
for _ in range(26):
    tc = rng.uniform(0.2, 8.8)
    n = int(rng.uniform(0.05, 0.14) * SR)
    tt = np.arange(n) / SR
    f = rng.uniform(1800, 3000) + np.floor(tt * 90) * rng.uniform(80, 200)  # stepped data tones
    add(np.sign(np.sin(2 * np.pi * np.cumsum(f) / SR)) * np.exp(-tt * 18) * 0.5, tc, 0.018, rng.uniform(-0.8, 0.8))

# 4. scene 1 fly-bys: the four giant numbers + panels
for z, pan in [(-130, -0.6), (-330, 0.7), (-520, -0.5), (-700, 0.6)]:
    tp = pass_time(z, 0, 3)
    w = whoosh(0.9, 250, 3500, peak=0.62)
    add(w, tp - 0.56, 0.32, pan)
for tp in rng.uniform(0.1, 2.9, 10):
    add(whoosh(0.5, 600, 5000, peak=0.6), tp, 0.08, rng.uniform(-1, 1))

# 5. powerful acceleration into the tunnel (2.2 -> 3.05) + entrance hit at 3.0
n = int(0.95 * SR)
tt = np.arange(n) / SR
rev = 70 * (1 + 4 * (tt / tt[-1]) ** 2)  # rising engine fundamental
engine = sum(np.sin(2 * np.pi * np.cumsum(rev * h) / SR) / h for h in (1, 2, 3, 4.02, 5.1))
engine = lp(engine, 2600) * (tt / tt[-1]) ** 1.6
add(engine / np.max(np.abs(engine)), 2.1, 0.32)
add(sweep_filter_noise(0.95, 200, 7000, q=0.8, curve=2) * (tt / tt[-1]) ** 2, 2.1, 0.18)
add(impact(1.4, body=42, punch=1.0, bright=0.6), 3.0, 0.62)

# 6. tunnel: a metallic swish every time a ring station passes the lens
for i in range(19):
    z = -840 - i * 110
    tp = pass_time(z, 3, 6)
    if tp >= 5.995:
        break
    dur = 0.38
    s = whoosh(dur, 900, 6500, peak=0.55, gain=1.0)
    tick = metal_tick(rng.uniform(1600, 2600), 0.3)
    s[: len(tick)] += tick[: len(s)] * 0.25
    add(s, tp - dur * 0.55, 0.16, 0.7 if i % 2 else -0.7)
# rising tunnel tone
n = int(3.0 * SR)
tt = np.arange(n) / SR
tone = np.sin(2 * np.pi * np.cumsum(110 * 2 ** (tt / 3 * 1.5)) / SR)
add(lp(tone, 1800) * (tt / 3) ** 1.5 * 0.5, 3.0, 0.12)
# hard stop of the tunnel layers at the exit
mix[int(5.995 * SR):int(6.0 * SR)] *= np.linspace(1, 0.2, int(0.005 * SR))[:, None]

# 7. financial collision: synchronized impacts on every cut
add(impact(2.2, body=36, punch=1.25, bright=1.0), 6.0, 0.95)
add(whoosh(1.2, 120, 9000, peak=0.05), 5.98, 0.35, 0)  # burst
for tc, body, pan in [(6.75, 52, -0.4), (7.45, 46, 0.45), (8.2, 40, 0)]:
    add(impact(1.2, body=body, punch=0.9, bright=0.9), tc, 0.55, pan)
    add(whoosh(0.4, 3000, 400, peak=0.08), tc, 0.12, -pan)
for tc in rng.uniform(6.05, 8.9, 14):  # debris
    add(metal_tick(rng.uniform(900, 3200), 0.35), tc, 0.07, rng.uniform(-1, 1))

# 8. convergence: sudden calm at 9.0, rising mechanical tone + ratchet + sub pulses
n = int(3.0 * SR)
tt = np.arange(n) / SR
u = tt / 3
f_rise = 55 * 2 ** (u * 2.4)
saw = signal.sawtooth(2 * np.pi * np.cumsum(f_rise) / SR)
saw2 = signal.sawtooth(2 * np.pi * np.cumsum(f_rise * 1.5) / SR)
rise = lp(saw + 0.6 * saw2, 900) * (0.15 + 0.85 * u ** 1.8)
add(rise / np.max(np.abs(rise)), 9.0, 0.17)
rate = 6 + 30 * u ** 2  # ratchet clicks accelerate into the push
phase = np.cumsum(rate) / SR
idx = np.where(np.diff(np.floor(phase)) > 0)[0]
for k in idx:
    add(metal_tick(2900, 0.06), 9.0 + k / SR, 0.05 + 0.08 * (k / n), 0.4 * np.sin(k))
for tc in np.arange(9.25, 11.9, 0.5):
    m = int(0.5 * SR)
    ts = np.arange(m) / SR
    add(np.sin(2 * np.pi * 38 * ts) * np.exp(-ts * 7), tc, 0.24)
add(sweep_filter_noise(1.0, 300, 9000, q=0.7, curve=2.2) * np.linspace(0, 1, SR) ** 2, 11.0, 0.22)  # push-in riser
add(np.zeros(1), 0)
# a breath of silence right before the flash
cut0, cut1 = int(11.94 * SR), int(12.0 * SR)
mix[cut0:cut1] *= np.linspace(1, 0.05, cut1 - cut0)[:, None]

# 9. logo: one clean cinematic impact, lock ticks, red streak swoosh, elegant decay
logo_hit = impact(3.0, body=33, punch=1.4, bright=0.7)
n = len(logo_hit)
tt = np.arange(n) / SR
shimmer = sum(np.sin(2 * np.pi * f * tt) * np.exp(-tt * 1.6) for f in (523.25, 784, 1046.5, 1568)) / 4
add(logo_hit + shimmer * 0.25, 12.0, 1.0)
for i in range(5):  # each letter locks into place
    add(metal_tick(3300 + i * 140, 0.18), 12.12 + i * 0.075 + 1.0, 0.07, (i - 2) * 0.35)
add(whoosh(1.0, 2000, 6000, peak=0.5), 12.55, 0.06, 0)

# ------------------------------------------------------------------ master
mix = reverb(mix, seconds=2.4, wet=0.22)
mix = hp(mix.T, 24).T
# gentle bus compression (soft knee) + limiter
peak_env = np.abs(mix).max(axis=1)
smooth = signal.sosfilt(signal.butter(1, 12, fs=SR, output='sos'), peak_env)
gain = 1 / np.maximum(1, (smooth / 0.5) ** 0.45)
mix *= gain[:, None]
mix /= np.max(np.abs(mix)) / 0.89  # -1 dBFS peak
# elegant decay: silence by the end of the hold
fade = np.clip((15.0 - t_all) / 1.4, 0, 1) ** 1.5
mix *= fade[:, None]
mix[-int(0.05 * SR):] = 0

out = sys.argv[1] if len(sys.argv) > 1 else 'soundtrack.wav'
pcm = (np.clip(mix, -1, 1) * 32767).astype('<i2')
with wave.open(out, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print(f'wrote {out}: {len(mix) / SR:.3f} s, peak {np.max(np.abs(mix)):.3f}, rms {np.sqrt(np.mean(mix ** 2)):.3f}')
