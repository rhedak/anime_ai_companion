"""Makes the trailer's sound from nothing but code: a short original backing track and sound effects timed to what the
video shows. Nothing here is sampled or taken from anyone, so there is no licence to quote and nothing for a
copyright-claim system to match.

    uv run --with numpy python trailer/audio.py cues.json out.wav [--no-music]

`cues.json` is {"duration": seconds, "cues": [{"t": seconds, "kind": "tap" | "key" | "send" | "reply" | ...}]}
as `compose.mjs` writes it. The result is stereo, 44.1 kHz, 16 bit, and a little under 0 dBFS; the final loudness is set
when the video is made.
"""

import json
import sys
import wave

import numpy as np

SR = 44100
rng = np.random.default_rng(7)  # the same noise every time, so the same cues give the same file


# ---- small building blocks -------------------------------------------------------------------------------------------
def t_axis(seconds: float) -> np.ndarray:
    return np.arange(int(seconds * SR)) / SR


def hz(note: int) -> float:
    """MIDI note number to frequency."""
    return 440.0 * 2 ** ((note - 69) / 12)


def env(n: int, attack: float, decay: float) -> np.ndarray:
    """A plucked envelope: a quick rise, then an exponential fall (`decay` is the time to fall to a thousandth)."""
    t = np.arange(n) / SR
    rise = np.minimum(1.0, t / max(attack, 1e-4))
    fall = np.exp(-6.9 * t / decay)
    return rise * fall


def lowpass(x: np.ndarray, cutoff: float) -> np.ndarray:
    """One-pole low-pass: enough to soften a bright wave."""
    a = np.exp(-2 * np.pi * cutoff / SR)
    out = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc = (1 - a) * v + a * acc
        out[i] = acc
    return out


def highpass(x: np.ndarray, cutoff: float) -> np.ndarray:
    return x - lowpass(x, cutoff)


def fast_lowpass(x: np.ndarray, cutoff: float) -> np.ndarray:
    """A moving-average low-pass: much faster than `lowpass` for long arrays, and good enough for noise and pads."""
    width = max(1, int(SR / cutoff))
    kernel = np.ones(width) / width
    return np.convolve(x, kernel, mode="same")


def place(mix: np.ndarray, sound: np.ndarray, at: float, gain: float = 1.0, pan: float = 0.0) -> None:
    """Add `sound` (mono) into the stereo `mix` at `at` seconds; `pan` is -1 left to 1 right."""
    start = int(at * SR)
    if start >= len(mix) or start + len(sound) <= 0:
        return
    s0 = max(0, -start)
    end = min(len(sound), len(mix) - start)
    left = gain * np.cos((pan + 1) * np.pi / 4)
    right = gain * np.sin((pan + 1) * np.pi / 4)
    mix[start + s0 : start + end, 0] += sound[s0:end] * left
    mix[start + s0 : start + end, 1] += sound[s0:end] * right


# ---- instruments -----------------------------------------------------------------------------------------------------
def pluck(freq: float, length: float = 0.35, bright: float = 0.5) -> np.ndarray:
    """A soft, bell-like pluck: a triangle and its octave, with the top rolled off."""
    t = t_axis(length)
    tri = 2 * np.abs(2 * ((t * freq) % 1) - 1) - 1
    wave_ = tri + bright * 0.4 * np.sin(2 * np.pi * freq * 2 * t)
    return fast_lowpass(wave_, 5000) * env(len(t), 0.003, length * 0.9)


def bell(freq: float, length: float = 0.6) -> np.ndarray:
    """A small glassy bell: sines at inharmonic ratios, each fading at its own speed."""
    t = t_axis(length)
    out = np.zeros_like(t)
    for ratio, amp, decay in ((1.0, 1.0, 0.55), (2.76, 0.45, 0.28), (5.4, 0.2, 0.16), (8.93, 0.08, 0.1)):
        out += amp * np.sin(2 * np.pi * freq * ratio * t) * np.exp(-6.9 * t / (length * decay / 0.55 * 0.9))
    return out * np.minimum(1.0, t / 0.002)


def bass_note(freq: float, length: float) -> np.ndarray:
    t = t_axis(length)
    w = np.sin(2 * np.pi * freq * t) + 0.25 * np.sin(2 * np.pi * freq * 2 * t)
    return w * env(len(t), 0.01, length * 1.1) * 0.9


def kick() -> np.ndarray:
    t = t_axis(0.28)
    f = 48 + 90 * np.exp(-t * 28)
    phase = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(phase) * np.exp(-t * 11)


def clap() -> np.ndarray:
    n = int(0.22 * SR)
    noise = rng.standard_normal(n)
    noise = highpass(fast_lowpass(noise, 6500), 900) if n < 60000 else noise
    t = np.arange(n) / SR
    bursts = np.exp(-t * 90) + 0.6 * np.exp(-np.maximum(t - 0.012, 0) * 60) * (t > 0.012)
    return noise * bursts * 0.9


def hat(open_: bool = False) -> np.ndarray:
    n = int((0.16 if open_ else 0.05) * SR)
    noise = rng.standard_normal(n)
    noise = noise - fast_lowpass(noise, 4500)
    return noise * np.exp(-np.arange(n) / SR * (22 if open_ else 90))


def pad(freqs: list[float], length: float) -> np.ndarray:
    t = t_axis(length)
    out = np.zeros_like(t)
    for f in freqs:
        for detune in (-0.004, 0.004):
            out += np.sin(2 * np.pi * f * (1 + detune) * t)
    out = fast_lowpass(out, 1800)
    swell = np.minimum(1.0, t / 0.5) * np.minimum(1.0, (length - t) / 0.5)
    return out * swell / (len(freqs) * 2)


# ---- the music: 4 bars, looping, at 116 bpm in C (F - G - Em - Am, the bright "royal road" turn) ------------------------
BPM = 116
BEAT = 60 / BPM
BAR = 4 * BEAT
PROGRESSION = [
    ("F", [53, 57, 60, 64], 41),  # Fmaj7: chord tones, bass root
    ("G", [55, 59, 62, 67], 43),
    ("Em", [52, 55, 59, 64], 40),
    ("Am", [57, 60, 64, 67], 45),
]


def music(duration: float) -> np.ndarray:
    mix = np.zeros((int(duration * SR) + SR, 2))
    bars = int(duration / BAR) + 1
    for bar in range(bars):
        name, chord, root = PROGRESSION[bar % 4]
        at = bar * BAR
        intensity = 0 if bar < 1 else 1 if bar < 4 else 2  # the arrangement grows: arp, then bass and pad, then drums
        # arpeggio: eighth notes up and back down the chord
        order = [0, 1, 2, 3, 2, 1, 2, 3]
        for i, k in enumerate(order):
            note = chord[k] + 12
            place(mix, pluck(hz(note), 0.32), at + i * BEAT / 2, 0.30 if intensity else 0.22, pan=-0.35 if i % 2 else 0.35)
        # a gentle high echo on the off-beats from the second round on
        if intensity >= 1:
            for i in (1, 3, 5, 7):
                place(mix, pluck(hz(chord[(i // 2) % 4] + 24), 0.22, 0.2), at + i * BEAT / 2 + BEAT / 4, 0.07, pan=0.6)
            place(mix, pad([hz(n) for n in chord], BAR + 0.15), at - 0.05, 0.20)
            place(mix, bass_note(hz(root), BEAT * 1.4), at, 0.55)
            place(mix, bass_note(hz(root), BEAT * 0.9), at + BEAT * 2.5, 0.45)
        if intensity >= 2:
            for beat in (0, 2):
                place(mix, kick(), at + beat * BEAT, 0.62)
            for beat in (1, 3):
                place(mix, clap(), at + beat * BEAT, 0.16)
            for i in range(8):
                place(mix, hat(i == 7), at + i * BEAT / 2, 0.07 if i % 2 else 0.04, pan=0.25)
    out = mix[: int(duration * SR)]
    fade_in, fade_out = int(1.2 * SR), int(2.4 * SR)
    out[:fade_in] *= np.linspace(0, 1, fade_in)[:, None]
    out[-fade_out:] *= np.linspace(1, 0, fade_out)[:, None] ** 1.5
    return out


# ---- sound effects ---------------------------------------------------------------------------------------------------
def sfx_key() -> np.ndarray:
    n = int(0.018 * SR)
    t = np.arange(n) / SR
    return (rng.standard_normal(n) * 0.5 + np.sin(2 * np.pi * (1800 + rng.integers(-250, 250)) * t) * 0.5) * np.exp(-t * 260)


def sfx_tap() -> np.ndarray:
    t = t_axis(0.09)
    f = 520 - 260 * (t / 0.09)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 38)


def sfx_send() -> np.ndarray:
    t = t_axis(0.26)
    f = 420 + 900 * (t / 0.26) ** 1.6
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR)
    air = fast_lowpass(rng.standard_normal(len(t)), 2400) * 1.6
    return (tone * 0.7 + air * 0.5) * np.sin(np.pi * np.minimum(1, t / 0.26)) ** 0.7


def sfx_reply() -> np.ndarray:
    a, b = bell(hz(84), 0.5), bell(hz(88), 0.6)
    out = np.zeros(int(0.8 * SR))
    out[: len(a)] += a * 0.7
    out[int(0.09 * SR) : int(0.09 * SR) + len(b)] += b * 0.8
    return out


def sfx_card() -> np.ndarray:
    out = np.zeros(int(0.5 * SR))
    for i, n in enumerate((79, 79, 86)):
        s = bell(hz(n), 0.28)
        at = int(i * 0.11 * SR)
        out[at : at + len(s)] += s * 0.7
    return out


def sfx_approve() -> np.ndarray:
    out = np.zeros(int(0.9 * SR))
    for i, n in enumerate((72, 76, 79, 84)):
        s = bell(hz(n), 0.5)
        at = int(i * 0.07 * SR)
        out[at : at + len(s)] += s * 0.6
    return out


def sfx_sparkle() -> np.ndarray:
    out = np.zeros(int(1.2 * SR))
    for i, n in enumerate((84, 88, 91, 96, 100)):
        s = bell(hz(n), 0.45)
        at = int(i * 0.065 * SR)
        out[at : at + len(s)] += s * (0.6 - i * 0.05)
    return out


def sfx_caption() -> np.ndarray:
    n = int(0.16 * SR)
    t = np.arange(n) / SR
    noise = fast_lowpass(rng.standard_normal(n), 3500) - fast_lowpass(rng.standard_normal(n), 500)
    return noise * np.sin(np.pi * t / 0.16) ** 2 * 1.4


def sfx_step(i: int) -> np.ndarray:
    scale = (72, 74, 76, 79, 81, 84, 86, 88, 91)
    return bell(hz(scale[i % len(scale)]), 0.32) * 0.8


def sfx_whoosh() -> np.ndarray:
    n = int(0.55 * SR)
    t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    band = fast_lowpass(noise, 600 + 5200 * (t / 0.55)) if False else noise
    # a sweep: filtered noise whose brightness climbs, then falls
    out = np.zeros(n)
    parts = 12
    for k in range(parts):
        lo, hi = int(k * n / parts), int((k + 1) * n / parts)
        cutoff = 500 + 4500 * np.sin(np.pi * (k + 0.5) / parts)
        out[lo:hi] = fast_lowpass(noise[lo:hi], cutoff)
    return out * np.sin(np.pi * t / 0.55) ** 2 * 2.2


def sfx_done() -> np.ndarray:
    return bell(hz(79), 0.5) * 0.5


def sfx_end() -> np.ndarray:
    out = np.zeros(int(2.4 * SR))
    for i, n in enumerate((72, 76, 79, 84, 88)):
        s = bell(hz(n), 1.6)
        at = int(i * 0.09 * SR)
        out[at : at + len(s)] += s * 0.55
    return out


# ---- putting it together -----------------------------------------------------------------------------------------------
def render(spec: dict, with_music: bool = True) -> np.ndarray:
    duration = float(spec["duration"])
    mix = music(duration) * 0.30 if with_music else np.zeros((int(duration * SR), 2))
    steps = 0
    keys = 0
    for cue in sorted(spec["cues"], key=lambda c: c["t"]):
        t, kind = float(cue["t"]), cue["kind"]
        if kind == "key":
            keys += 1
            if keys % 2 == 0:  # every other keystroke: a soft patter, not a machine gun
                place(mix, sfx_key(), t, 0.10, pan=float(rng.uniform(-0.2, 0.2)))
        elif kind == "tap":
            place(mix, sfx_tap(), t, 0.40)
        elif kind == "send":
            place(mix, sfx_send(), t, 0.32)
        elif kind == "reply":
            place(mix, sfx_reply(), t, 0.34)
        elif kind == "card":
            place(mix, sfx_card(), t, 0.36)
        elif kind == "approve":
            place(mix, sfx_approve(), t, 0.36)
        elif kind == "sparkle":
            place(mix, sfx_sparkle(), t, 0.40, pan=0.15)
        elif kind == "caption":
            place(mix, sfx_caption(), t, 0.22)
        elif kind == "step":
            place(mix, sfx_step(steps), t, 0.30)
            steps += 1
        elif kind == "whoosh":
            place(mix, sfx_whoosh(), t - 0.28, 0.30)
        elif kind == "done":
            place(mix, sfx_done(), t, 0.20)
        elif kind == "end":
            place(mix, sfx_end(), t, 0.42)
    peak = np.max(np.abs(mix)) or 1.0
    return mix * (0.89 / peak)


def write_wav(path: str, audio: np.ndarray) -> None:
    pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


if __name__ == "__main__":
    spec = json.load(open(sys.argv[1]))
    write_wav(sys.argv[2], render(spec, with_music="--no-music" not in sys.argv))
    print(f"wrote {sys.argv[2]}: {spec['duration']:.1f} s, {len(spec['cues'])} cues")
