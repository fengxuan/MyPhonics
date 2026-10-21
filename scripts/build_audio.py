#!/usr/bin/env python3
"""Download phoneme and word recordings, then trim them into mp3 clips."""

import array
import json
import re
import subprocess
import sys
import threading
import time
import urllib.parse
import wave
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = (ROOT / "js" / "data.js").read_text()
SOUND_DIR = ROOT / "audio" / "sounds"
WORD_DIR = ROOT / "audio" / "words"
TMP = Path("/tmp/phonics-audio-src")
URLS_PATH = Path("/tmp/audio_urls.json")
UA = "MyPhonicsEdu/1.0 (local phonics lesson; classroom use)"

IPA = {
    "s": "Voiceless alveolar sibilant.ogg",
    "a": "Near-open front unrounded vowel.ogg",
    "t": "Voiceless alveolar plosive.ogg",
    "p": "Voiceless bilabial plosive.ogg",
    "i": "Near-close near-front unrounded vowel.ogg",
    "n": "Alveolar nasal.ogg",
    "m": "Bilabial nasal.ogg",
    "d": "Voiced alveolar plosive.ogg",
    "g": "Voiced velar plosive 02.ogg",
    "o": "Open back unrounded vowel.ogg",
    "k": "Voiceless velar plosive.ogg",
    "e": "Open-mid front unrounded vowel.ogg",
    "u": "PR-open-mid back unrounded vowel2.ogg",
    "r": "Alveolar approximant.ogg",
    "h": "Voiceless glottal fricative.ogg",
    "b": "Voiced bilabial plosive.ogg",
    "f": "Voiceless labio-dental fricative.ogg",
    "l": "Alveolar lateral approximant.ogg",
    "j": "Voiced palato-alveolar affricate.ogg",
    "v": "Voiced labio-dental fricative.ogg",
    "w": "Voiced labio-velar approximant.ogg",
    "y": "Palatal approximant.ogg",
    "z": "Voiced alveolar sibilant.ogg",
    "sh": "Voiceless palato-alveolar sibilant.ogg",
    "ch": "Voiceless palato-alveolar affricate.ogg",
    "th": "Voiceless dental fricative.ogg",
    "thv": "Voiced dental fricative.ogg",
    "ng": "Velar nasal.ogg",
    "ee": "Close front unrounded vowel.ogg",
    "oo": "Close back rounded vowel.ogg",
    "oos": "Near-close near-back rounded vowel.ogg",
}

# Human word recordings used as the pure sound.
FROM_WORD = {
    "igh": "eye",
    "ar": "are",
    "or": "or",
    "er": "er",
    "ow": "ow",
}

SAY = {
    "ay": "A",
    "oh": "O",
    "oy": "oi",
}


def run(cmd):
    subprocess.check_call(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


RATE_LOCK = threading.Lock()
LAST_FETCH = [0.0]


def curl(url, dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 400:
        return
    tmp = dest.with_suffix(dest.suffix + ".part")
    for attempt in range(8):
        with RATE_LOCK:
            wait_for = 0.45 - (time.time() - LAST_FETCH[0])
            if wait_for > 0:
                time.sleep(wait_for)
            LAST_FETCH[0] = time.time()
        if tmp.exists():
            tmp.unlink()
        result = subprocess.run(
            ["curl", "-fsSL", "--max-time", "40", "--connect-timeout", "12", "-A", UA, "-o", str(tmp), url],
            capture_output=True,
            text=True,
        )
        if result.returncode == 0 and tmp.exists() and tmp.stat().st_size > 400:
            tmp.replace(dest)
            return
        if tmp.exists():
            tmp.unlink()
        time.sleep(min(20, 1.5 * (attempt + 1)))
    raise RuntimeError(f"download failed: {url} {result.stderr[-180:]}")


def commons_file(filename):
    return "https://commons.wikimedia.org/wiki/Special:FilePath/" + urllib.parse.quote(filename)


def lookup_words(words):
    found = {}
    if URLS_PATH.exists():
        found.update(json.loads(URLS_PATH.read_text()))
    missing = [word for word in words if word not in found]
    for start in range(0, len(missing), 40):
        chunk = missing[start : start + 40]
        if not chunk:
            continue
        titles = "|".join(f"File:En-us-{word}.ogg" for word in chunk)
        url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(
            {
                "action": "query",
                "titles": titles,
                "format": "json",
                "prop": "imageinfo",
                "iiprop": "url",
            }
        )
        raw = subprocess.check_output(["curl", "-fsSL", "--retry", "4", "--retry-delay", "1", "-A", UA, url])
        data = json.loads(raw)
        for page in data["query"]["pages"].values():
            name = page["title"].replace("File:En-us-", "").replace(".ogg", "")
            if "missing" in page:
                continue
            found[name] = page["imageinfo"][0]["url"]
    return found


def read_wav(path):
    with wave.open(str(path)) as handle:
        channels = handle.getnchannels()
        rate = handle.getframerate()
        frames = handle.readframes(handle.getnframes())
    samples = array.array("h")
    samples.frombytes(frames)
    if channels == 2:
        samples = array.array("h", samples[0::2])
    return samples, rate


def trim(samples, rate, max_voice):
    if len(samples) < rate // 20:
        return samples
    step = max(1, int(rate * 0.01))
    envelope = []
    for index in range(0, len(samples) - step, step):
        window = samples[index : index + step]
        envelope.append((sum(value * value for value in window) / len(window)) ** 0.5)
    peak = max(envelope) if envelope else 0
    if peak < 80:
        return samples
    threshold = max(160, peak * 0.12)
    loud = [index for index, value in enumerate(envelope) if value >= threshold]
    if not loud:
        return samples
    start = max(0, loud[0] * step - int(rate * 0.02))
    end = min(len(samples), (loud[-1] + 1) * step + int(rate * 0.05))
    limit = int(rate * max_voice)
    if end - start > limit:
        end = start + limit
    cut = array.array("h", samples[start:end])
    fade = min(len(cut) // 4, int(rate * 0.012))
    for index in range(fade):
        gain = index / fade
        cut[index] = int(cut[index] * gain)
        cut[-1 - index] = int(cut[-1 - index] * gain)
    loudest = max((abs(value) for value in cut), default=1) or 1
    gain = min(6.0, 26000 / loudest)
    normalized = array.array("h", (max(-32767, min(32767, int(value * gain))) for value in cut))
    pad = array.array("h", [0] * int(rate * 0.03))
    return pad + normalized + pad


def write_wav(path, samples, rate):
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "w") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(samples.tobytes())


def to_mp3(wav_path, mp3_path, max_voice):
    samples, rate = read_wav(wav_path)
    trimmed = trim(samples, rate, max_voice)
    shaped = wav_path.with_suffix(".trim.wav")
    write_wav(shaped, trimmed, rate)
    mp3_path.parent.mkdir(parents=True, exist_ok=True)
    run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(shaped),
            "-codec:a",
            "libmp3lame",
            "-q:a",
            "5",
            str(mp3_path),
        ]
    )


def ogg_to_wav(src, dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    run(["ffmpeg", "-y", "-i", str(src), "-ac", "1", "-ar", "22050", str(dest)])


def say_to_wav(text, dest):
    aiff = dest.with_suffix(".aiff")
    run(["say", "-v", "Samantha (英语（美国）)", "-r", "148", "-o", str(aiff), text])
    run(["afconvert", "-f", "WAVE", "-d", "LEI16@22050", str(aiff), str(dest)])


def needed_words():
    words = set(re.findall(r'word\("([a-z]+)"', DATA))
    words.update(re.findall(r'keyword: "([a-z]+)"', DATA))
    words.update(FROM_WORD.values())
    words.discard("")
    return sorted(words)


def build():
    SOUND_DIR.mkdir(parents=True, exist_ok=True)
    WORD_DIR.mkdir(parents=True, exist_ok=True)
    TMP.mkdir(parents=True, exist_ok=True)
    words = needed_words()
    urls = lookup_words(words)
    missing = [word for word in words if word not in urls]
    if missing:
        raise SystemExit(f"Missing word audio: {', '.join(missing)}")

    jobs = []
    for word in words:
        jobs.append(("word", word, urls[word]))
    for sound, filename in IPA.items():
        jobs.append(("ipa", sound, commons_file(filename)))

    def fetch(job):
        kind, name, url = job
        dest = TMP / kind / f"{name}.ogg"
        curl(url, dest)
        return kind, name, dest

    print(f"Downloading {len(jobs)} recordings...")
    paths = {}
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(fetch, job) for job in jobs]
        done = 0
        for future in as_completed(futures):
            kind, name, dest = future.result()
            paths[(kind, name)] = dest
            done += 1
            if done % 20 == 0 or done == len(jobs):
                print(f"  {done}/{len(jobs)}")

    print("Encoding words...")
    for word in words:
        wav = TMP / "wav" / f"word-{word}.wav"
        ogg_to_wav(paths[("word", word)], wav)
        to_mp3(wav, WORD_DIR / f"{word}.mp3", 1.8)

    print("Encoding phonemes from word slices...")
    subprocess.check_call([sys.executable, str(Path(__file__).with_name("slice_phonemes.py"))])

    for sound, word in FROM_WORD.items():
        wav = TMP / "wav" / f"word-{word}.wav"
        to_mp3(wav, SOUND_DIR / f"{sound}.mp3", 0.75)

    print("Synthesizing diphthongs...")
    for sound, text in SAY.items():
        wav = TMP / "wav" / f"say-{sound}.wav"
        say_to_wav(text, wav)
        to_mp3(wav, SOUND_DIR / f"{sound}.mp3", 0.7)

    short = []
    for folder in (SOUND_DIR, WORD_DIR):
        for mp3 in sorted(folder.glob("*.mp3")):
            if mp3.stat().st_size < 700:
                short.append(mp3.name)
    print(f"sounds {len(list(SOUND_DIR.glob('*.mp3')))}  words {len(list(WORD_DIR.glob('*.mp3')))}")
    if short:
        print("Short files:", ", ".join(short))


if __name__ == "__main__":
    build()
