#!/usr/bin/env python3
"""
Piper TTS worker for Sunny Side Sips.

- Loads local Piper voices from config/piper/en and config/piper/vn only.
- Never downloads models. Never touches the network.
- Keeps loaded voices in memory so live TikTok comments are spoken quickly.
- Speaks JSON lines over stdin: {"id":1,"text":"...","voice":"<model id>","language":"en","speed":1.0}
- Answers on stdout: {"type":"result","id":1,"ok":true,"url":"/tts-cache/..."}

The worker is started once by the Bun server and stays isolated from the game loop.
"""
import hashlib
import inspect
import json
import os
import re
import subprocess
import sys
import time
import traceback
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MODELS_ROOT = ROOT / "config" / "piper"
CACHE_DIR = ROOT / "data" / "tts-cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

MAX_CHARS = 220
URL_RE = re.compile(r"https?://\S+", re.IGNORECASE)
BRACKET_EMOTE_RE = re.compile(r"\[[^\]]{1,24}\]")
REPEATED_CHARS_RE = re.compile(r"(.)\1{3,}", re.IGNORECASE)
MULTI_PUNCT_RE = re.compile(r"([.,!?])\1+")
MULTI_SPACE_RE = re.compile(r"\s+")
# Letters and digits from any script (English + Vietnamese), plus light punctuation.
ALLOWED_RE = re.compile(r"[^\w\s.,!?'\"&$+#%-]", re.UNICODE)
LETTER_RE = re.compile(r"[^\W\d_]", re.UNICODE)

_voices = {}


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def pretty_name(stem: str) -> str:
    name = re.sub(r"^piper[-_]", "", stem, flags=re.IGNORECASE)
    name = re.sub(r"^(en|vi)[-_][A-Za-z]{2}[-_]", "", name, flags=re.IGNORECASE)
    name = re.sub(r"^(en|vi)[-_]", "", name, flags=re.IGNORECASE)
    name = re.sub(r"\b(medium|low|high|x_low|x-low)\b", "", name, flags=re.IGNORECASE)
    name = name.replace("_", " ").replace("-", " ").strip()
    if not name:
        return stem
    words = [w if w.isupper() or w.isdigit() else w.capitalize() for w in name.split()]
    return " ".join(words)


def discover_voices() -> list:
    voices = []
    if not MODELS_ROOT.is_dir():
        return voices
    for language_dir in sorted(p for p in MODELS_ROOT.iterdir() if p.is_dir()):
        folder = language_dir.name.lower()
        # The repo stores Vietnamese voices in config/piper/vn.
        language = "vi" if folder in ("vi", "vn") else folder
        for model in sorted(language_dir.glob("*.onnx")):
            config_path = Path(str(model) + ".json")
            if not config_path.is_file():
                continue
            config = {}
            try:
                config = json.loads(config_path.read_text(encoding="utf-8"))
            except Exception:
                config = {}
            voice_id = model.stem
            voices.append({
                "id": voice_id,
                "language": language,
                "name": pretty_name(voice_id),
                "path": str(model),
                "sampleRate": int((config.get("audio") or {}).get("sample_rate") or 22050),
                "espeak": (config.get("espeak") or {}).get("voice") or language,
            })
    return voices


def find_voice(voice_id: str, language: str) -> dict:
    voices = discover_voices()
    if voice_id:
        for voice in voices:
            if voice["id"] == voice_id:
                return voice
    for voice in voices:
        if voice["language"] == language:
            return voice
    return voices[0] if voices else {}


def clean_text(raw) -> str:
    text = URL_RE.sub(" ", str(raw or ""))
    text = BRACKET_EMOTE_RE.sub(" ", text)
    text = text.replace("\u200b", " ").replace("\ufeff", " ")
    text = ALLOWED_RE.sub(" ", text)
    text = MULTI_PUNCT_RE.sub(r"\1", text)
    text = REPEATED_CHARS_RE.sub(r"\1\1", text)
    text = MULTI_SPACE_RE.sub(" ", text).strip(" .,!?-")
    if len(LETTER_RE.findall(text)) < 2:
        return ""
    if len(text) > MAX_CHARS:
        text = text[:MAX_CHARS].rsplit(" ", 1)[0]
    return text


def piper_cli_path() -> str:
    exe = os.environ.get("PIPER_EXE", "").strip()
    kind = os.environ.get("PIPER_EXE_KIND", "").strip()
    if exe and os.path.isfile(exe) and kind == "piper":
        return exe
    return ""


def synthesize_with_cli(model_path: str, text: str, out_path: Path, speed: float) -> None:
    exe = piper_cli_path()
    if not exe:
        raise RuntimeError("Piper executable not available")
    length_scale = 1.0 / max(0.25, min(3.0, float(speed or 1.0)))
    cmd = [exe, "-m", model_path, "-f", str(out_path), "--length-scale", f"{length_scale:.3f}", "--", text]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
    if proc.returncode != 0 or not out_path.is_file() or out_path.stat().st_size < 500:
        raise RuntimeError((proc.stderr or proc.stdout or "Piper CLI failed").strip()[:300])


def load_voice(voice: dict):
    voice_id = voice.get("id") or ""
    if voice_id in _voices:
        return _voices[voice_id]
    from piper import PiperVoice  # imported lazily so startup is fast
    loaded = PiperVoice.load(voice["path"], config_path=voice.get("configPath") or None)
    _voices[voice_id] = loaded
    return loaded


def synthesis_config(speed: float):
    from piper import SynthesisConfig
    length_scale = 1.0 / max(0.25, min(3.0, float(speed or 1.0)))
    params = inspect.signature(SynthesisConfig).parameters
    kwargs = {}
    if "length_scale" in params:
        kwargs["length_scale"] = length_scale
    if "volume" in params:
        kwargs["volume"] = 1.0
    return SynthesisConfig(**kwargs)


def synthesize_with_api(voice: dict, text: str, out_path: Path, speed: float) -> float:
    loaded = load_voice(voice)
    chunks = list(loaded.synthesize(text, syn_config=synthesis_config(speed)))
    if not chunks:
        raise RuntimeError("Piper produced no audio")
    sample_rate = int(getattr(chunks[0], "sample_rate", 22050))
    with wave.open(str(out_path), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        for chunk in chunks:
            wav_file.writeframes(chunk.audio_int16_bytes)
    return sample_rate


def main() -> None:
    voices = discover_voices()
    engine_version = "unknown"
    try:
        from importlib.metadata import version as package_version
        engine_version = package_version("piper-tts")
    except Exception as exc:
        emit({"type": "warning", "message": f"piper python module missing: {exc}"})

    emit({
        "type": "ready",
        "engine": "piper",
        "version": engine_version,
        "exe": os.environ.get("PIPER_EXE", ""),
        "exeKind": os.environ.get("PIPER_EXE_KIND", ""),
        "modelsRoot": str(MODELS_ROOT),
        "languages": sorted({v["language"] for v in voices}),
        "voices": [{"id": v["id"], "language": v["language"], "name": v["name"],
                    "sampleRate": v["sampleRate"], "espeak": v["espeak"]} for v in voices],
    })

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req_id = None
        try:
            req = json.loads(line)
            req_id = req.get("id")
            if req.get("cmd") == "voices":
                emit({"type": "voices", "id": req_id, "voices": discover_voices()})
                continue
            if req.get("cmd") == "warm":
                voice = find_voice(req.get("voice") or "", req.get("language") or "en")
                if voice:
                    load_voice(voice)
                    emit({"type": "warm", "voice": voice["id"], "ok": True})
                continue

            text = clean_text(req.get("text"))
            language = str(req.get("language") or "en").lower()
            speed = float(req.get("speed") or 1.0)
            if not text:
                emit({"type": "result", "id": req_id, "ok": False, "error": "Empty or spam text"})
                continue

            voice = find_voice(req.get("voice") or "", language)
            if not voice:
                emit({"type": "result", "id": req_id, "ok": False, "error": "No Piper voice model found in config/piper"})
                continue

            cache_src = f"piper-v1::{voice['id']}::{speed:.2f}::{text}".encode("utf-8")
            cache_key = hashlib.sha1(cache_src).hexdigest()[:20]
            out_name = f"piper_{voice['id']}_{cache_key}.wav"
            out_path = CACHE_DIR / out_name

            if out_path.is_file() and out_path.stat().st_size > 500:
                emit({
                    "type": "result", "id": req_id, "ok": True, "cached": True,
                    "voice": voice["id"], "language": voice["language"], "speed": speed,
                    "file": out_name, "url": f"/tts-cache/{out_name}", "synthSec": 0.0,
                })
                continue

            started = time.time()
            try:
                sample_rate = synthesize_with_api(voice, text, out_path, speed)
            except Exception as api_exc:
                if not piper_cli_path():
                    raise
                emit({"type": "warning", "message": f"Python API failed ({api_exc}); using Piper CLI"})
                synthesize_with_cli(voice["path"], text, out_path, speed)
                sample_rate = voice.get("sampleRate") or 22050

            duration = 0.0
            try:
                with wave.open(str(out_path), "rb") as wav_file:
                    duration = round(wav_file.getnframes() / float(wav_file.getframerate() or sample_rate), 2)
            except Exception:
                duration = 0.0

            emit({
                "type": "result", "id": req_id, "ok": True, "cached": False,
                "voice": voice["id"], "language": voice["language"], "speed": speed,
                "file": out_name, "url": f"/tts-cache/{out_name}",
                "sampleRate": sample_rate, "durationSec": duration,
                "synthSec": round(time.time() - started, 2),
            })
        except Exception as exc:
            emit({
                "type": "result", "id": req_id, "ok": False,
                "error": str(exc), "trace": traceback.format_exc()[:600],
            })


if __name__ == "__main__":
    main()
