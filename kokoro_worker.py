#!/usr/bin/env python3
"""
Kokoro-82M TTS worker for Sunny Side Sips.

- Runs in its own Python virtual environment (.venv-kokoro by default).
- Loads the Kokoro model once and keeps it resident for the server lifetime.
- Uses CPU by default; uses CUDA when PyTorch reports an available device.
- Generates 24 kHz mono PCM16 WAV files in data/tts-cache.
- Speaks JSON lines over stdin and answers on stdout, matching piper_worker.py.
- No cloud TTS API is called. The model/voice weights are downloaded once by
  Kokoro/Hugging Face and then reused from the local cache.
"""

from __future__ import annotations

import hashlib
import inspect
import json
import os
import re
import sys
import time
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CACHE_DIR = ROOT / "data" / "tts-cache"
HF_HOME = ROOT / "data" / "kokoro-cache" / "huggingface"
CACHE_DIR.mkdir(parents=True, exist_ok=True)
HF_HOME.mkdir(parents=True, exist_ok=True)

# Keep Hugging Face downloads inside the project instead of the user profile.
os.environ.setdefault("HF_HOME", str(HF_HOME))
os.environ.setdefault("HF_HUB_CACHE", str(HF_HOME / "hub"))
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

MAX_CHARS = 220
SAMPLE_RATE = 24000
CACHE_MAX_AGE_SECONDS = 14 * 24 * 60 * 60
MODEL_ID = os.environ.get("KOKORO_MODEL", "hexgrad/Kokoro-82M")
DEFAULT_VOICE = os.environ.get("KOKORO_VOICE", "af_heart")

URL_RE = re.compile(r"https?://\S+", re.IGNORECASE)
BRACKET_EMOTE_RE = re.compile(r"\[[^\]]{1,24}\]")
REPEATED_CHARS_RE = re.compile(r"(.)\1{3,}", re.IGNORECASE)
MULTI_PUNCT_RE = re.compile(r"([.,!?])\1+")
MULTI_SPACE_RE = re.compile(r"\s+")
ALLOWED_RE = re.compile(r"[^\w\s.,!?'\"&$+#%:;()\-]", re.UNICODE)
LETTER_RE = re.compile(r"[^\W\d_]", re.UNICODE)

# These are the American-English Kokoro voices used for the shop profiles.
# The worker reports this actual catalog to the server and Admin panel.
KOKORO_VOICES = [
    {"id": "af_heart", "name": "Heart", "gender": "female", "language": "en", "langCode": "a"},
    {"id": "af_bella", "name": "Bella", "gender": "female", "language": "en", "langCode": "a"},
    {"id": "af_nicole", "name": "Nicole", "gender": "female", "language": "en", "langCode": "a"},
    {"id": "af_sarah", "name": "Sarah", "gender": "female", "language": "en", "langCode": "a"},
    {"id": "af_sky", "name": "Sky", "gender": "female", "language": "en", "langCode": "a"},
    {"id": "af_alloy", "name": "Alloy", "gender": "female", "language": "en", "langCode": "a"},
    {"id": "af_aoede", "name": "Aoede", "gender": "female", "language": "en", "langCode": "a"},
    {"id": "af_jessica", "name": "Jessica", "gender": "female", "language": "en", "langCode": "a"},
    {"id": "af_kore", "name": "Kore", "gender": "female", "language": "en", "langCode": "a"},
    {"id": "af_nova", "name": "Nova", "gender": "female", "language": "en", "langCode": "a"},
    {"id": "af_river", "name": "River", "gender": "female", "language": "en", "langCode": "a"},
    {"id": "am_adam", "name": "Adam", "gender": "male", "language": "en", "langCode": "a"},
    {"id": "am_michael", "name": "Michael", "gender": "male", "language": "en", "langCode": "a"},
    {"id": "am_echo", "name": "Echo", "gender": "male", "language": "en", "langCode": "a"},
    {"id": "am_eric", "name": "Eric", "gender": "male", "language": "en", "langCode": "a"},
    {"id": "am_fenrir", "name": "Fenrir", "gender": "male", "language": "en", "langCode": "a"},
    {"id": "am_liam", "name": "Liam", "gender": "male", "language": "en", "langCode": "a"},
    {"id": "am_onyx", "name": "Onyx", "gender": "male", "language": "en", "langCode": "a"},
    {"id": "am_puck", "name": "Puck", "gender": "male", "language": "en", "langCode": "a"},
    {"id": "am_santa", "name": "Santa", "gender": "male", "language": "en", "langCode": "a"},
]
VOICE_IDS = {voice["id"] for voice in KOKORO_VOICES}


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def clean_text(raw) -> str:
    text = URL_RE.sub(" ", str(raw or ""))
    text = BRACKET_EMOTE_RE.sub(" ", text)
    text = text.replace("\u200b", " ").replace("\ufeff", " ")
    text = ALLOWED_RE.sub(" ", text)
    text = MULTI_PUNCT_RE.sub(r"\1", text)
    text = REPEATED_CHARS_RE.sub(r"\1\1", text)
    text = MULTI_SPACE_RE.sub(" ", text).strip(" .,!?-\n\t")
    if len(LETTER_RE.findall(text)) < 2:
        return ""
    if len(text) > MAX_CHARS:
        text = text[:MAX_CHARS].rsplit(" ", 1)[0]
    return text


def cleanup_cache() -> None:
    cutoff = time.time() - CACHE_MAX_AGE_SECONDS
    for file in CACHE_DIR.glob("kokoro_*.wav"):
        try:
            if file.stat().st_mtime < cutoff:
                file.unlink()
        except OSError:
            pass


def load_runtime():
    import torch
    from kokoro import KPipeline

    try:
        threads = int(os.environ.get("KOKORO_THREADS", "0"))
    except ValueError:
        threads = 0
    if threads <= 0:
        threads = max(1, min(8, os.cpu_count() or 4))
    torch.set_num_threads(threads)
    try:
        torch.set_num_interop_threads(1)
    except Exception:
        pass
    torch.set_grad_enabled(False)

    cuda = bool(torch.cuda.is_available())
    device = "cuda" if cuda else "cpu"
    kwargs = {"lang_code": "a", "repo_id": MODEL_ID}
    try:
        params = inspect.signature(KPipeline).parameters
        if "device" in params and cuda:
            kwargs["device"] = device
    except Exception:
        pass
    pipeline = KPipeline(**kwargs)
    return pipeline, torch, device


def model_path() -> str:
    hub = HF_HOME / "hub"
    match = sorted(hub.glob("models--hexgrad--Kokoro-82M/snapshots/*"))
    return str(match[-1] if match else hub / "models--hexgrad--Kokoro-82M")


def main() -> None:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

    emit({
        "type": "loading",
        "engine": "kokoro",
        "model": MODEL_ID,
        "startedAt": time.time(),
    })
    cleanup_cache()
    started = time.time()
    try:
        pipeline, torch, device = load_runtime()
    except Exception as exc:
        emit({
            "type": "fatal",
            "engine": "kokoro",
            "error": f"Kokoro model failed to load: {exc}",
            "trace": traceback.format_exc()[-1200:],
        })
        raise SystemExit(2)

    try:
        from importlib.metadata import version as package_version
        version = package_version("kokoro")
    except Exception:
        version = "unknown"

    loaded_voices = []
    available = getattr(pipeline, "voices", None)
    if isinstance(available, (list, tuple, set)):
        for voice in available:
            if voice in VOICE_IDS:
                loaded_voices.append(voice)
    catalog = [v for v in KOKORO_VOICES if not loaded_voices or v["id"] in loaded_voices]
    if not catalog:
        catalog = list(KOKORO_VOICES)

    emit({
        "type": "ready",
        "engine": "kokoro",
        "model": MODEL_ID,
        "version": version,
        "device": device,
        "cuda": bool(torch.cuda.is_available()),
        "threads": torch.get_num_threads(),
        "sampleRate": SAMPLE_RATE,
        "voices": catalog,
        "modelPath": model_path(),
        "loadMs": round((time.time() - started) * 1000),
    })

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req_id = None
        try:
            req = json.loads(line)
            req_id = req.get("id")
            cmd = req.get("cmd")
            if cmd == "voices":
                emit({"type": "voices", "id": req_id, "voices": KOKORO_VOICES})
                continue
            if cmd == "status":
                emit({
                    "type": "status",
                    "id": req_id,
                    "ready": True,
                    "device": device,
                    "threads": torch.get_num_threads(),
                    "voices": KOKORO_VOICES,
                })
                continue
            if cmd == "warm":
                voice = str(req.get("voice") or DEFAULT_VOICE)
                if voice not in VOICE_IDS:
                    voice = DEFAULT_VOICE
                started = time.time()
                try:
                    if hasattr(pipeline, "load_voice"):
                        pipeline.load_voice(voice)
                    emit({
                        "type": "warm",
                        "id": req_id,
                        "ok": True,
                        "voice": voice,
                        "loadMs": round((time.time() - started) * 1000),
                    })
                except Exception as exc:
                    emit({"type": "warm", "id": req_id, "ok": False, "error": str(exc)})
                continue

            text = clean_text(req.get("text"))
            speed = float(req.get("speed") or 1.0)
            speed = max(0.5, min(2.0, speed))
            voice = str(req.get("voice") or DEFAULT_VOICE)
            if voice not in VOICE_IDS:
                voice = DEFAULT_VOICE
            if not text:
                emit({"type": "result", "id": req_id, "ok": False, "error": "Empty or spam text"})
                continue

            cache_src = f"kokoro-v1::{voice}::{speed:.2f}::{text}".encode("utf-8")
            cache_key = hashlib.sha1(cache_src).hexdigest()[:20]
            out_name = f"kokoro_{voice}_{cache_key}.wav"
            out_path = CACHE_DIR / out_name

            if out_path.is_file() and out_path.stat().st_size > 500:
                import soundfile as sf
                info = sf.info(str(out_path))
                emit({
                    "type": "result",
                    "id": req_id,
                    "ok": True,
                    "cached": True,
                    "engine": "kokoro",
                    "voice": voice,
                    "language": "en",
                    "speed": speed,
                    "file": out_name,
                    "url": f"/tts-cache/{out_name}",
                    "sampleRate": info.samplerate,
                    "durationSec": round(info.frames / float(info.samplerate or SAMPLE_RATE), 2),
                    "synthSec": 0.0,
                })
                continue

            generation_started = time.time()
            audio_parts = []
            for _gs, _ps, audio in pipeline(
                text,
                voice=voice,
                speed=speed,
                split_pattern=r"\n+",
            ):
                if audio is None:
                    continue
                if hasattr(audio, "detach"):
                    audio = audio.detach().cpu().numpy()
                audio_parts.append(audio)
            if not audio_parts:
                raise RuntimeError("Kokoro produced no audio")

            import numpy as np
            import soundfile as sf
            audio = audio_parts[0] if len(audio_parts) == 1 else np.concatenate(audio_parts)
            tmp_path = out_path.with_suffix(".tmp.wav")
            sf.write(str(tmp_path), audio, SAMPLE_RATE, subtype="PCM_16")
            os.replace(tmp_path, out_path)
            info = sf.info(str(out_path))

            emit({
                "type": "result",
                "id": req_id,
                "ok": True,
                "cached": False,
                "engine": "kokoro",
                "voice": voice,
                "language": "en",
                "speed": speed,
                "file": out_name,
                "url": f"/tts-cache/{out_name}",
                "sampleRate": info.samplerate,
                "durationSec": round(info.frames / float(info.samplerate or SAMPLE_RATE), 2),
                "synthSec": round(time.time() - generation_started, 2),
            })
        except Exception as exc:
            try:
                if "tmp_path" in locals() and Path(tmp_path).exists():
                    Path(tmp_path).unlink()
            except OSError:
                pass
            emit({
                "type": "result",
                "id": req_id,
                "ok": False,
                "engine": "kokoro",
                "error": str(exc),
                "trace": traceback.format_exc()[-800:],
            })


if __name__ == "__main__":
    main()
