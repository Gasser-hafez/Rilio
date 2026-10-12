# موسيقى الفيديو: lo-fi هادية + whoosh عند كل مشهد + كليك مع كل ضغطة ماوس — كلها متولّدة بالكود (مفيش حقوق).
# التشغيل: python3 promo/music.py  →  promo/out/music.wav
import numpy as np, wave, os

SR = 44100
DUR = 132.0
BPM = 96
BEAT = 60 / BPM
N = int(SR * DUR)
L = np.zeros(N); R = np.zeros(N)
rng = np.random.default_rng(7)

SCENES = [6, 13, 23, 29, 39, 46, 58, 63, 75, 86, 92, 100, 111, 118, 124]
CLICKS = [17.3, 25.6, 48.3, 52.9, 68.9, 70.9, 77.4, 88.7, 102.2]
CHIMES = [17.45, 25.75, 50.7, 59.6, 106.4]

def midi(n): return 440 * 2 ** ((n - 69) / 12)
def add(sig, t, pan=0.0, gain=1.0):
    i = int(t * SR)
    if i >= N: return
    sig = sig[:N - i] * gain
    L[i:i + len(sig)] += sig * np.sqrt((1 - pan) / 2) * 1.414
    R[i:i + len(sig)] += sig * np.sqrt((1 + pan) / 2) * 1.414
def env(n, a, r):
    e = np.ones(n); A = int(a * SR); Rr = int(r * SR)
    if A: e[:A] = np.linspace(0, 1, A)
    if Rr: e[-Rr:] *= np.linspace(1, 0, Rr)
    return e
def lowpass(x, cut):
    # one-pole بتردد ثابت أو متغير (array)
    y = np.zeros_like(x); s = 0.0
    a = 1 - np.exp(-2 * np.pi * np.broadcast_to(cut, x.shape) / SR)
    for i in range(len(x)):
        s += a[i] * (x[i] - s); y[i] = s
    return y

# كوردات: Am9 – Fmaj7 – Cmaj7 – G6 (كل كورد بارين = 8 ضربات)
CH = [[57, 60, 64, 67, 71], [53, 57, 60, 64, 69], [48, 55, 59, 64, 67], [55, 59, 62, 64, 67]]
ROOT = [45, 41, 48, 43]
SEG = 8 * BEAT
nseg = int(DUR / SEG) + 1

# pad
for k in range(nseg):
    t0 = k * SEG; n = int((SEG + 1.2) * SR); tt = np.arange(n) / SR
    chord = CH[k % 4]
    for j, m in enumerate(chord):
        f = midi(m)
        for det, pan in ((0.9985, -0.6), (1.0015, 0.6)):
            ph = 2 * np.pi * f * det * tt
            s = np.sin(ph) + .25 * np.sin(2 * ph) + .08 * np.sin(3 * ph)
            s *= env(n, 1.4, 1.6) * (1 + .15 * np.sin(2 * np.pi * .3 * tt + j))
            add(s, t0, pan, .018)

# bass
for k in range(nseg):
    t0 = k * SEG
    if t0 < 6 or t0 > 124: continue
    for b in (0, 3, 4, 6.5):
        n = int(BEAT * 1.4 * SR); tt = np.arange(n) / SR
        f = midi(ROOT[k % 4] - 12 + (7 if b == 6.5 else 0))
        s = np.sin(2 * np.pi * f * tt) + .3 * np.sin(4 * np.pi * f * tt)
        s *= np.exp(-tt * 2.2) * env(n, .01, .08)
        add(s, t0 + b * BEAT, 0, .16)

# drums
def kick():
    n = int(.45 * SR); tt = np.arange(n) / SR
    f = 45 + 80 * np.exp(-tt * 28)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 7)
def snare():
    n = int(.3 * SR); tt = np.arange(n) / SR
    nz = rng.standard_normal(n); nz = nz - lowpass(nz, 900)
    return (lowpass(nz, 6000) * .8 + .3 * np.sin(2 * np.pi * 190 * tt)) * np.exp(-tt * 16)
def hat():
    n = int(.06 * SR); tt = np.arange(n) / SR
    nz = rng.standard_normal(n); nz = nz - lowpass(nz, 7000)
    return nz * np.exp(-tt * 70)
K, S_, H = kick(), snare(), hat()
nb = int(DUR / BEAT)
for b in range(nb):
    t = b * BEAT
    if t < 6 or t >= 124: continue
    full = t >= 13
    if b % 4 in (0, 2) or (full and b % 8 == 7): add(K, t, 0, .55 if full else .35)
    if full and b % 4 in (1, 3): add(S_, t, .1, .16)
    if full:
        for h in (0, .5):
            add(H, t + h * BEAT + (0.018 if h else 0), -.3 if h else .3, .05 if h else .035)
# sidechain خفيف: بنوطّي الباد مع كل كيك
duck = np.ones(N)
for b in range(nb):
    t = b * BEAT
    if 6 <= t < 124 and b % 2 == 0:
        i = int(t * SR); n = min(int(.35 * SR), N - i)
        duck[i:i + n] = np.minimum(duck[i:i + n], 1 - .35 * np.exp(-np.arange(n) / SR * 9))

# arpeggio pluck
step = BEAT / 2
for k in range(int(DUR / step)):
    t = k * step
    if t < 13 or t >= 124: continue
    seg = int(t // SEG) % 4
    pat = [0, 2, 4, 2, 1, 3, 4, 3]
    m = CH[seg][pat[k % 8]] + 12
    n = int(.6 * SR); tt = np.arange(n) / SR
    f = midi(m)
    tri = 2 / np.pi * np.arcsin(np.sin(2 * np.pi * f * tt))
    s = (tri * .7 + .3 * np.sin(2 * np.pi * 2 * f * tt)) * np.exp(-tt * 6.5) * env(n, .004, .05)
    add(s, t, .45 if k % 2 else -.45, .05 * (0.8 + .2 * ((k % 4) == 0)))

L *= duck; R *= duck

# whoosh عند بداية كل مشهد
for t in SCENES:
    n = int(.9 * SR); tt = np.arange(n) / SR
    nz = rng.standard_normal(n)
    cut = 300 + 5000 * (tt / .9) ** 2
    w = lowpass(nz, cut) * np.sin(np.pi * np.clip(tt / .9, 0, 1)) ** 2
    add(w, t - .65, -.3, .28); add(lowpass(rng.standard_normal(n), cut) * np.sin(np.pi * tt / .9) ** 2, t - .65, .3, .28)
# كليكات
for t in CLICKS:
    n = int(.05 * SR); tt = np.arange(n) / SR
    add(np.sin(2 * np.pi * 1800 * tt) * np.exp(-tt * 140) + .4 * rng.standard_normal(n) * np.exp(-tt * 300), t, 0, .22)
# شايم نجاح
for t in CHIMES:
    for j, m in enumerate((84, 88, 91)):
        n = int(1.0 * SR); tt = np.arange(n) / SR
        s = np.sin(2 * np.pi * midi(m) * tt) * np.exp(-tt * 4)
        add(s, t + j * .07, (j - 1) * .4, .05)
# ضربة النهاية
n = int(5 * SR); tt = np.arange(n) / SR
for m in (45, 57, 64, 67, 71, 76):
    add(np.sin(2 * np.pi * midi(m) * tt) * np.exp(-tt * .7) * env(n, .02, 1), 124.2, 0, .05)

mix = np.stack([L, R], 1)
mix = np.tanh(mix * 1.2)
mix /= np.abs(mix).max() / .89
fi, fo = int(.8 * SR), int(2.2 * SR)
mix[:fi] *= np.linspace(0, 1, fi)[:, None]
mix[-fo:] *= np.linspace(1, 0, fo)[:, None]
os.makedirs(os.path.join(os.path.dirname(__file__), 'out'), exist_ok=True)
out = os.path.join(os.path.dirname(__file__), 'out', 'music.wav')
with wave.open(out, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mix * 32767).astype('<i2').tobytes())
print(out)
