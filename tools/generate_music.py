#!/usr/bin/env python3
"""
Mystic Witch Live — background playlist generator.

Builds the eight instrumental tracks that ship in public/assets/music with a
small additive-synthesis engine (numpy + the Python standard library) and
encodes them to MP3 with ffmpeg (libmp3lame).

Everything here is generated from scratch: no samples, loops or melodies from
third parties are used, so the output is original and safe to stream.

Usage:  python tools/generate_music.py
"""
import os
import subprocess
import wave

import numpy as np

SR = 44100
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'public', 'assets', 'music')

SCALES = {
    'major': [0, 2, 4, 5, 7, 9, 11],
    'mixolydian': [0, 2, 4, 5, 7, 9, 10],
    'dorian': [0, 2, 3, 5, 7, 9, 10],
}


# --------------------------------------------------------------------------- voices
def hz(midi_note):
    return 440.0 * 2.0 ** ((midi_note - 69) / 12.0)


def _env(n, attack, release_s, length_s):
    t = np.arange(n) / SR
    a = np.clip(t / attack, 0, 1) if attack > 0 else np.ones(n)
    r = np.clip((length_s - t) / release_s, 0, 1) if release_s > 0 else np.ones(n)
    return a * r


def pluck(freq, dur, bright=0.45):
    n = max(16, int(dur * SR))
    t = np.arange(n) / SR
    out = np.zeros(n)
    for k, amp in ((1, 1.0), (2, bright * 0.55), (3, bright * 0.3), (4, bright * 0.17), (5, bright * 0.09)):
        out += amp * np.sin(2 * np.pi * freq * k * t) * np.exp(-t * (3.0 + k * 1.9))
    return out * _env(n, 0.005, 0.05, dur) * 0.3


def pad(freq, dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for det in (-0.0022, 0.0, 0.0022):
        out += np.sin(2 * np.pi * freq * (1 + det) * t) + 0.22 * np.sin(4 * np.pi * freq * (1 + det) * t)
    return out * _env(n, 0.35, 0.55, dur) * 0.055


def bass(freq, dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    sig = np.sin(2 * np.pi * freq * t) + 0.24 * np.sin(4 * np.pi * freq * t)
    return sig * _env(n, 0.012, 0.08, dur) * np.exp(-t / 0.85) * 0.34


def marimba(freq, dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    sig = (
        np.sin(2 * np.pi * freq * t) * np.exp(-t * 5.0)
        + 0.32 * np.sin(2 * np.pi * freq * 4 * t) * np.exp(-t * 10.0)
        + 0.10 * np.sin(2 * np.pi * freq * 10 * t) * np.exp(-t * 16.0)
    )
    return sig * _env(n, 0.003, 0.04, dur) * 0.26


def bell(freq, dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    sig = np.zeros(n)
    for ratio, amp, dec in ((1, 1.0, 2.1), (2.76, 0.38, 3.3), (5.4, 0.16, 5.0), (8.9, 0.07, 7.0)):
        sig += amp * np.sin(2 * np.pi * freq * ratio * t) * np.exp(-t * dec)
    return sig * _env(n, 0.004, 0.05, dur) * 0.14


LEADS = {'pluck': pluck, 'marimba': marimba, 'bell': bell}


def kick(level=0.55):
    n = int(0.24 * SR)
    t = np.arange(n) / SR
    sweep = 105 * np.exp(-t * 24) + 46
    return np.sin(2 * np.pi * np.cumsum(sweep) / SR) * np.exp(-t * 9) * level


def snare(level=0.16, seed=5):
    n = int(0.16 * SR)
    rng = np.random.default_rng(seed)
    noise = np.diff(rng.standard_normal(n + 1))
    t = np.arange(n) / SR
    body = np.sin(2 * np.pi * 190 * t) * 0.35
    return (noise * np.exp(-t * 26) + body * np.exp(-t * 18)) * level


def hat(level=0.13, seed=7):
    n = int(0.05 * SR)
    rng = np.random.default_rng(seed)
    noise = np.diff(np.concatenate([[0.0], rng.standard_normal(n)]))
    return noise * np.exp(-np.arange(n) / (SR * 0.011)) * level


def shaker(level=0.09, seed=11):
    n = int(0.09 * SR)
    rng = np.random.default_rng(seed)
    noise = np.diff(rng.standard_normal(n + 1))
    t = np.arange(n) / SR
    return noise * np.sin(np.pi * np.clip(t / 0.09, 0, 1)) ** 2 * level


def vinyl(total, level=0.012):
    rng = np.random.default_rng(23)
    n = int(total * SR)
    noise = rng.standard_normal(n) * level
    # slow amplitude wobble + occasional crackle
    wobble = 1.0 + 0.35 * np.sin(2 * np.pi * 0.23 * np.arange(n) / SR)
    crackle = (rng.random(n) > 0.99985) * rng.standard_normal(n) * 0.25
    return (noise * wobble) + crackle


# --------------------------------------------------------------------------- helpers
def add(buf, sig, at, gain=1.0):
    i = int(at * SR)
    if i < 0 or i >= len(buf):
        return
    end = min(len(buf), i + len(sig))
    buf[i:end] += sig[: end - i] * gain


def reverb(x, mix=0.16):
    out = x.copy()
    for delay, g in ((0.083, 0.55), (0.149, 0.36), (0.223, 0.24), (0.311, 0.15)):
        d = int(delay * SR)
        out[d:] += x[:-d] * g * mix
    return out


def write_mp3(samples, slug, title):
    os.makedirs(OUT_DIR, exist_ok=True)
    peak = float(np.max(np.abs(samples))) or 1.0
    samples = samples / peak * 0.82
    samples = np.tanh(samples * 1.05) * 0.95
    pcm = np.int16(np.clip(samples, -1, 1) * 32767)
    wav_path = os.path.join(OUT_DIR, slug + '.wav')
    with wave.open(wav_path, 'wb') as fh:
        fh.setnchannels(2)
        fh.setsampwidth(2)
        fh.setframerate(SR)
        stereo = np.column_stack([pcm, pcm]).reshape(-1)
        fh.writeframes(stereo.tobytes())
    mp3_path = os.path.join(OUT_DIR, slug + '.mp3')
    subprocess.run(
        [
            'ffmpeg', '-y', '-loglevel', 'error', '-i', wav_path,
            '-codec:a', 'libmp3lame', '-b:a', '128k', '-ar', str(SR),
            '-metadata', 'title=' + title,
            '-metadata', 'artist=Mystic Witch Live',
            '-metadata', 'album=Mystic Witch Live — Background Playlist',
            '-metadata', 'comment=Original royalty-free instrumental generated locally',
            mp3_path,
        ],
        check=True,
    )
    os.remove(wav_path)
    return mp3_path


# --------------------------------------------------------------------------- tracks
TRACKS = [
    dict(
        slug='sunny-morning', title='Sunny Morning', tempo=104, root=60, scale='major',
        prog=[0, 4, 5, 3, 0, 4, 3, 4], cycles=4, lead='marimba', lead_oct=1,
        arp=[0, 1, 2, 3, 2, 1, 2, 1], melody=[2, None, 1, 0, None, 1, 2, None],
        kick=[0, 2], snare=[], hat=0.12, shaker=0.0, seventh=False,
        gains=dict(arp=0.85, lead=0.9, bass=1.0, pad=1.0),
    ),
    dict(
        slug='summer-lemonade', title='Summer Lemonade', tempo=112, root=67, scale='major',
        prog=[0, 4, 5, 3, 0, 4, 5, 4], cycles=4, lead='marimba', lead_oct=1,
        arp=[0, 2, 1, 3, 0, 2, 3, 1], melody=[1, None, 2, 3, None, 2, 1, None],
        kick=[0, 2], snare=[1, 3], hat=0.09, shaker=0.10, seventh=False,
        gains=dict(arp=0.8, lead=0.95, bass=1.0, pad=0.9),
    ),
    dict(
        slug='happy-cafe', title='Happy Café', tempo=96, root=65, scale='major',
        prog=[0, 5, 3, 4, 0, 5, 1, 4], cycles=4, lead='pluck', lead_oct=1,
        arp=[0, 1, 2, 1, 3, 2, 1, 2], melody=[0, None, 2, None, 1, 2, None, 1],
        kick=[0, 2], snare=[2], hat=0.16, shaker=0.0, seventh=True,
        gains=dict(arp=0.95, lead=0.8, bass=0.95, pad=1.1),
    ),
    dict(
        slug='weekend-vibes', title='Weekend Vibes', tempo=118, root=62, scale='mixolydian',
        prog=[0, 3, 4, 0, 5, 3, 4, 4], cycles=4, lead='pluck', lead_oct=1,
        arp=[0, 2, 1, 2, 3, 2, 1, 0], melody=[1, 2, None, 1, 0, None, 2, 1],
        kick=[0, 2], snare=[1, 3], hat=0.13, shaker=0.07, seventh=False,
        gains=dict(arp=0.9, lead=0.85, bass=1.05, pad=0.85),
    ),
    dict(
        slug='beachside-drive', title='Beachside Drive', tempo=100, root=69, scale='major',
        prog=[0, 3, 4, 5, 0, 3, 1, 4], cycles=4, lead='marimba', lead_oct=2,
        arp=[0, 1, 2, 3, 1, 2, 3, 2], melody=[2, None, 3, None, 2, 1, None, 3],
        kick=[0, 1, 2, 3], snare=[2], hat=0.08, shaker=0.12, seventh=False,
        gains=dict(arp=0.75, lead=0.9, bass=1.0, pad=1.0),
    ),
    dict(
        slug='coffee-break', title='Coffee Break', tempo=78, root=70, scale='dorian',
        prog=[0, 3, 1, 4, 0, 3, 5, 4], cycles=4, lead='pluck', lead_oct=1,
        arp=[0, None, 1, None, 2, None, 1, None], melody=[1, None, None, 2, None, 1, None, None],
        kick=[0, 2], snare=[], hat=0.07, shaker=0.05, seventh=True, vinyl=True,
        gains=dict(arp=0.9, lead=0.55, bass=1.0, pad=1.25),
    ),
    dict(
        slug='good-times', title='Good Times', tempo=108, root=64, scale='major',
        prog=[0, 4, 3, 5, 0, 4, 1, 4], cycles=4, lead='bell', lead_oct=2,
        arp=[0, 1, 2, 3, 2, 3, 1, 2], melody=[2, None, 1, 2, 3, None, 2, None],
        kick=[0, 2], snare=[1, 3], hat=0.12, shaker=0.06, seventh=False,
        gains=dict(arp=0.85, lead=0.75, bass=1.0, pad=0.9),
    ),
    dict(
        slug='little-sunshine', title='Little Sunshine', tempo=92, root=60, scale='major',
        prog=[0, 5, 1, 4, 0, 5, 3, 4], cycles=4, lead='bell', lead_oct=2,
        arp=[0, 1, 2, 1, 3, 2, 1, 0], melody=[0, None, 1, None, 2, None, 1, None],
        kick=[0, 2], snare=[], hat=0.06, shaker=0.09, seventh=True,
        gains=dict(arp=0.7, lead=0.7, bass=0.85, pad=1.2),
    ),
]


def render(cfg):
    beat = 60.0 / cfg['tempo']
    bar = 4 * beat
    bars = 8 * cfg['cycles']
    total = bars * bar + 2.0
    buf = np.zeros(int(total * SR), dtype=np.float64)
    scale = SCALES[cfg['scale']]
    lead_fn = LEADS[cfg['lead']]
    gains = cfg['gains']
    tail = 1.6

    for b in range(bars):
        t0 = b * bar
        deg = cfg['prog'][b % len(cfg['prog'])]
        tones = [cfg['root'] + scale[(deg + s) % 7] + 12 * ((deg + s) // 7) for s in (0, 2, 4, 6)]
        pad_tones = tones[:3] + ([tones[3]] if cfg['seventh'] else [])

        # sustained pad
        for note in pad_tones:
            add(buf, pad(hz(note), bar + 0.25), t0, gains['pad'] * 0.9)

        # arpeggio on eighth notes
        step = beat / 2.0
        for i, tone_index in enumerate(cfg['arp']):
            if tone_index is None:
                continue
            note = tones[tone_index] + (12 if cfg['seventh'] and tone_index == 3 else 0)
            add(buf, pluck(hz(note), min(1.4, step * 1.8)), t0 + i * step, gains['arp'] * 0.8)

        # bass
        for pos in ([0, 1.5, 2, 3.5] if cfg['tempo'] < 90 else [0, 2]):
            note = tones[0] - 24
            if pos == 1.5 or pos == 3.5:
                note += 7
            add(buf, bass(hz(note), beat * 0.95), t0 + pos * beat, gains['bass'] * 0.85)

        # melody
        for i, tone_index in enumerate(cfg['melody']):
            if tone_index is None:
                continue
            note = tones[tone_index % len(tones)] + 12 * cfg['lead_oct']
            add(buf, lead_fn(hz(note), min(2.2, beat * 2.2)), t0 + i * step, gains['lead'] * 0.9)

        # drums
        for pos in cfg['kick']:
            add(buf, kick(), t0 + pos * beat, 0.95)
        for pos in cfg['snare']:
            add(buf, snare(), t0 + pos * beat, 0.9)
        for i in range(8):
            add(buf, hat(cfg['hat'] + (0.03 if i % 2 == 0 else 0.0)), t0 + i * step, 1.0)
            if cfg['shaker']:
                add(buf, shaker(cfg['shaker']), t0 + (i + 0.5) * step, 1.0)

    if cfg.get('vinyl'):
        buf += vinyl(total, 0.011)  # type: ignore[assignment]

    # gentle loop-friendly edges
    fade_in = int(0.6 * SR)
    buf[:fade_in] *= np.linspace(0.0, 1.0, fade_in)
    fade_out = int(2.0 * SR)
    buf[-fade_out:] *= np.linspace(1.0, 0.0, fade_out)

    mixed = reverb(buf, 0.14)
    return mixed[: int((total - 0.6) * SR)]


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for cfg in TRACKS:
        audio = render(cfg)
        path = write_mp3(audio, cfg['slug'], cfg['title'])
        size = os.path.getsize(path) / 1024.0
        print(f"{cfg['title']:<16} {audio.size / SR:5.1f}s  {size:7.1f} KB  {os.path.relpath(path, ROOT)}")


if __name__ == '__main__':
    main()
