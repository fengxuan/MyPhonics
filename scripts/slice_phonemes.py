#!/usr/bin/env python3
"""Replace isolated phoneme clips with slices of the real word recordings.

Wikimedia's consonant demos are mostly a consonant plus a loud vowel. The old
trim kept that vowel, so t sounded like a vowel. Times below are milliseconds
into the donor recording, chosen where the burst, fricative, or vowel nucleus
actually sits.
"""

import array
import math
import subprocess
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WAV_DIR = Path("/tmp/phonics-audio-src/wav")
OUT_DIR = ROOT / "audio" / "sounds"

# word, start ms, end ms, fade ms, optional decay ms (cuts off a following vowel)
WINDOWS = {
    "t": ("hot", 415, 478, 4),
    "p": ("pat", 92, 136, 4),
    "k": ("kit", 35, 118, 5),
    "d": ("dog", 112, 148, 4),
    "g": ("flag", 395, 445, 4),
    "b": ("bug", 98, 145, 3, 12),
    "s": ("sat", 55, 170, 6),
    "z": ("zip", 105, 190, 5),
    "f": ("fat", 30, 120, 5),
    "v": ("van", 240, 290, 5),
    "h": ("hat", 115, 172, 5),
    "sh": ("ship", 70, 205, 6),
    "ch": ("chin", 270, 385, 5),
    "j": ("jam", 290, 355, 5),
    "th": ("thin", 315, 470, 6),
    "thv": ("this", 225, 285, 4),
    "m": ("map", 20, 85, 6),
    "n": ("pin", 540, 680, 8),
    "ng": ("ring", 300, 470, 10),
    "l": ("leg", 95, 160, 6),
    "r": ("red", 90, 165, 6),
    "w": ("web", 265, 345, 6),
    "y": ("yes", 120, 190, 6),
    "a": ("sat", 175, 265, 10),
    "e": ("bed", 140, 265, 10),
    "i": ("sit", 255, 345, 10),
    "o": ("hot", 175, 285, 10),
    "u": ("bus", 350, 480, 10),
    "ee": ("sea", 315, 445, 10),
    "oo": ("moon", 100, 250, 10),
    "oos": ("book", 60, 170, 10),
}


def load_wav(path):
    with wave.open(str(path)) as handle:
        rate = handle.getframerate()
        channels = handle.getnchannels()
        frames = handle.readframes(handle.getnframes())
    samples = array.array("h")
    samples.frombytes(frames)
    if channels == 2:
        samples = array.array("h", samples[0::2])
    return samples, rate


def clip(samples, rate, start_ms, end_ms, fade_ms, decay_ms=None):
    start = int(rate * start_ms / 1000)
    end = int(rate * end_ms / 1000)
    piece = array.array("h", samples[start:end])
    if decay_ms:
        decay = int(rate * decay_ms / 1000)
        for index in range(decay, len(piece)):
            gain = math.exp(-(index - decay) / (rate * 0.01))
            piece[index] = int(piece[index] * gain)
    fade = min(len(piece) // 4, int(rate * fade_ms / 1000))
    for index in range(fade):
        gain = index / fade if fade else 1
        piece[index] = int(piece[index] * gain)
        piece[-1 - index] = int(piece[-1 - index] * gain)
    peak = max((abs(value) for value in piece), default=1) or 1
    gain = min(10.0, 26000 / peak)
    boosted = array.array("h", (max(-32767, min(32767, int(value * gain))) for value in piece))
    pad = array.array("h", [0] * int(rate * 0.02))
    return pad + boosted + pad


def voice_stats(samples, rate):
    step = max(1, int(rate * 0.005))
    loud = []
    for index in range(0, len(samples) - step, step):
        segment = samples[index : index + step]
        rms = math.sqrt(sum(value * value for value in segment) / len(segment))
        if rms > 500:
            loud.append(index)
    if not loud:
        return 0, 0
    segment = samples[loud[0] : loud[-1] + step]
    if len(segment) < 4:
        return 0, 0
    crossings = sum(
        1
        for index in range(1, len(segment))
        if (segment[index - 1] >= 0) != (segment[index] >= 0)
    )
    return len(segment) / rate, crossings / len(segment) * rate


def write_wav(path, samples, rate):
    with wave.open(str(path), "w") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(samples.tobytes())


def to_mp3(wav_path, mp3_path):
    subprocess.check_call(
        ["ffmpeg", "-y", "-i", str(wav_path), "-codec:a", "libmp3lame", "-q:a", "4", str(mp3_path)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"{'id':6} {'word':8} {'dur':6} {'zc':7}")
    for sound, spec in WINDOWS.items():
        word, start, end, fade = spec[:4]
        decay = spec[4] if len(spec) > 4 else None
        samples, rate = load_wav(WAV_DIR / f"word-{word}.wav")
        piece = clip(samples, rate, start, end, fade, decay)
        wav_path = WAV_DIR / f"slice-{sound}.wav"
        write_wav(wav_path, piece, rate)
        to_mp3(wav_path, OUT_DIR / f"{sound}.mp3")
        duration, zc = voice_stats(piece, rate)
        print(f"{sound:6} {word:8} {duration:5.3f}s {zc:6.0f}")


if __name__ == "__main__":
    main()
