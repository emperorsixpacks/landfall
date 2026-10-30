"""Server-side audio analysis and clip cutting (CPU only: librosa + ffmpeg).

All numbers are estimates and are labelled as such in the UI. The heavy imports
are lazy so the API can still start if an audio dependency is missing; a missing
dependency degrades to a structured error instead of a crash.
"""
from __future__ import annotations

import hashlib
import subprocess
import time
from pathlib import Path
from typing import Optional

from . import cache, config

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
# Krumhansl-Schmuckler key profiles (correlate chroma against these).
MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

GRID_SEC = 0.5  # analysis time grid


def _file_for(song_id: str) -> Optional[Path]:
    for d in (config.UPLOAD_DIR, config.SAMPLES_DIR):
        p = d / song_id
        if p.exists():
            return p
    for d in (config.UPLOAD_DIR, config.SAMPLES_DIR):
        for p in d.glob(f"{song_id}*"):
            return p
    return None


def _ffmpeg(args: list[str], timeout: float = 120.0) -> None:
    subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *args],
        check=True,
        capture_output=True,
        timeout=timeout,
    )


def _load_audio(path: Path):
    import librosa

    y, sr = librosa.load(str(path), sr=config.ANALYSIS_SR, mono=True)
    return y, sr, librosa


# --- analysis -----------------------------------------------------------------
def analyze(song_id: str) -> dict:
    """Return features, sections, and ranked hook windows. Cached by file hash."""
    src = _file_for(song_id)
    if src is None:
        return {"ok": False, "error": f"no audio file for song_id={song_id}"}
    try:
        h = hashlib.sha256(src.read_bytes()).hexdigest()
    except OSError:
        return {"ok": False, "error": "could not read audio file"}

    cached = cache.get("audio", {"hash": h}, 3600)
    if cached:
        return cached

    result = _analyze_file(src)
    if result.get("ok"):
        cache.put("audio", {"hash": h}, result)
    return result


def _analyze_file(src: Path) -> dict:
    try:
        y, sr, librosa = _load_audio(src)
        import numpy as np
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"audio load failed: {e}"}

    try:
        duration = float(len(y)) / sr
        if duration > config.MAX_DURATION_SECONDS:
            return {"ok": False, "error": f"longer than {config.MAX_DURATION_SECONDS // 60} min"}

        tempo, beats = _tempo(y, sr, librosa)
        key, mode, key_conf = _key(y, sr, librosa, np)
        energy = _energy_curve(y, sr, librosa, np)
        loudness = _loudness(y, sr)
        brightness = _brightness(y, sr, librosa)
        onset_density, novelty = _onset(y, sr, librosa, np)
        sections = _sections(y, sr, beats, duration, librosa, np)
        hooks = _hook_windows(duration, beats, sr, energy["curve"], novelty, sections, librosa, np)

        return {
            "ok": True,
            "duration": round(duration, 2),
            "tempo": round(float(tempo), 1),
            "beats": int(len(beats)),
            "key": key,
            "mode": mode,
            "key_confidence": key_conf,
            "energy": {
                "mean": energy["mean"],
                "peak": energy["peak"],
                "dynamic_range": energy["dynamic_range"],
                "curve": energy["curve"],
            },
            "loudness_lufs": loudness,
            "brightness": brightness,
            "onset_density_per_sec": onset_density,
            "sections": sections,
            "hooks": hooks,
        }
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"analysis failed: {e}"}


def _tempo(y, sr, librosa):
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr)
    t = float(tempo.item()) if hasattr(tempo, "item") else float(tempo)
    if t < 60:
        t *= 2
    elif t > 200:
        t /= 2
    return t, beats


def _key(y, sr, librosa, np):
    chroma = librosa.feature.chroma_stft(y=y, sr=sr)
    chroma_mean = chroma.mean(axis=1)
    best = None
    second = None
    for offset in range(12):
        rolled = np.roll(chroma_mean, offset)
        maj = np.corrcoef(rolled, MAJOR_PROFILE)[0, 1]
        minr = np.corrcoef(rolled, MINOR_PROFILE)[0, 1]
        for corr, mode in ((maj, "major"), (minr, "minor")):
            if best is None or corr > best[0]:
                second = best
                best = (corr, offset, mode)
            elif second is None or corr > second[0]:
                second = (corr, offset, mode)
    key = NOTE_NAMES[best[1]]
    conf = round(float(best[0] - (second[0] if second else 0)), 3)
    return key, best[2], conf


def _energy_curve(y, sr, librosa, np):
    hop = int(sr * GRID_SEC)
    rms = librosa.feature.rms(y=y, frame_length=hop, hop_length=hop)[0]
    rms = np.convolve(rms, np.ones(3) / 3, mode="same")
    rmax = rms.max() if rms.max() > 0 else 1.0
    curve = (rms / rmax).tolist()
    return {
        "mean": round(float(rms.mean()), 4),
        "peak": round(float(rms.max()), 4),
        "dynamic_range": round(float(np.percentile(rms, 95) - np.percentile(rms, 10)), 4),
        "curve": [round(float(v), 4) for v in curve],
    }


def _loudness(y, sr) -> Optional[float]:
    try:
        import pyloudnorm as pyln

        meter = pyln.Meter(sr)
        return round(float(meter.integrated_loudness(y)), 1)
    except Exception:  # noqa: BLE001
        return None


def _brightness(y, sr, librosa):
    cent = librosa.feature.spectral_centroid(y=y, sr=sr)[0]
    melspec = librosa.feature.melspectrogram(y=y, sr=sr, n_mels=40)
    mel = melspec.mean(axis=1)
    low = float(mel[:8].sum())
    mid = float(mel[8:24].sum())
    high = float(mel[24:].sum())
    total = low + mid + high or 1.0
    return {
        "centroid_hz": round(float(cent.mean()), 1),
        "low": round(low / total, 3),
        "mid": round(mid / total, 3),
        "high": round(high / total, 3),
    }


def _onset(y, sr, librosa, np):
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    onsets = librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr)
    density = round(float(len(onsets) / max(len(y) / sr, 1)), 3)
    env = (onset_env - onset_env.min()) / (onset_env.max() - onset_env.min() + 1e-9)
    hop_sec = 512.0 / sr
    n_bins = int(len(y) / sr / GRID_SEC) + 1
    out = np.zeros(n_bins)
    for i in range(n_bins):
        j0 = int(i * GRID_SEC / hop_sec)
        j1 = int((i + 1) * GRID_SEC / hop_sec)
        out[i] = env[j0:j1].max() if j1 > j0 else 0.0
    return density, out


def _sections(y, sr, beats, duration, librosa, np):
    try:
        chroma = librosa.feature.chroma_stft(y=y, sr=sr)
        mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=12)
        if len(beats) < 4:
            beats = np.arange(0, chroma.shape[1], 8)
        chroma_sync = librosa.util.sync(chroma, beats, aggregate=np.median)
        mfcc_sync = librosa.util.sync(mfcc, beats, aggregate=np.median)
        feat = np.vstack([chroma_sync, mfcc_sync])
        k = max(2, int(duration / 25))
        seg_ids = librosa.segment.agglomerative(feat, k=k)
        beat_times = librosa.frames_to_time(beats, sr=sr)
        labels = ["A", "B", "C", "D", "E", "F", "G", "H"]
        sections = []
        cur = None
        for i, sid in enumerate(seg_ids):
            name = labels[int(sid) % len(labels)]
            t = round(float(beat_times[i]), 2)
            if cur is None or cur["label"] != name:
                cur = {"label": name, "start": t, "end": t}
                sections.append(cur)
            cur["end"] = t
        for s in sections:
            s["end"] = round(min(s["end"] + 2.0, duration), 2)
        return sections
    except Exception:  # noqa: BLE001
        return [{"label": "A", "start": 0.0, "end": round(duration, 2)}]


def _hook_windows(duration, beats, sr, curve, novelty, sections, librosa, np):
    from collections import Counter

    curve = np.asarray(curve)
    n_curve = len(curve)

    def _mean(a, b):
        a = max(0, int(a / GRID_SEC))
        b = min(n_curve, max(a + 1, int(b / GRID_SEC)))
        seg = curve[a:b]
        return float(seg.mean()) if len(seg) else 0.0

    def _nov(a, b):
        a = max(0, int(a / GRID_SEC))
        b = min(len(novelty), max(a + 1, int(b / GRID_SEC)))
        return float(novelty[a:b].max()) if b > a else 0.0

    def _section(t):
        for s in sections:
            if s["start"] <= t <= s["end"]:
                return s["label"]
        return None

    counts = Counter(s["label"] for s in sections)
    total = len(sections) or 1
    beat_times = librosa.frames_to_time(beats, sr=sr)

    candidates = []
    for length in (30, 25, 20, 15):
        step = 5
        s = 0.0
        while s <= duration - length:
            e = s + length
            mean_e = _mean(s, e)
            nov = _nov(s, e)
            rep = counts.get(_section(s), 0) / total if _section(s) else 0.0
            score = 0.5 * mean_e + 0.3 * nov + 0.2 * rep
            snap = min(beat_times, key=lambda b: abs(b - s)) if len(beat_times) else s
            candidates.append(
                {
                    "start": round(float(snap), 2),
                    "end": round(float(snap) + length, 2),
                    "score": round(score, 4),
                    "length": length,
                }
            )
            s += step

    candidates.sort(key=lambda w: w["score"], reverse=True)
    chosen = []
    for w in candidates:
        if any(_overlap(w, c) for c in chosen):
            continue
        chosen.append(w)
        if len(chosen) >= config.CLIP_COUNT:
            break
    return chosen


def _overlap(a, b):
    return not (a["end"] <= b["start"] or b["end"] <= a["start"])


def _peaks(src: Path, start: float, end: float, n: int = 300) -> list[float]:
    try:
        import librosa
        import numpy as np

        y, sr = librosa.load(
            str(src), sr=config.ANALYSIS_SR, mono=True,
            offset=start, duration=end - start,
        )
        if len(y) == 0:
            return [0.0] * n
        idx = np.linspace(0, len(y) - 1, n).astype(int)
        amp = np.abs(y[idx])
        amax = amp.max() or 1.0
        return [round(float(a / amax), 4) for a in amp]
    except Exception:  # noqa: BLE001
        return [0.0] * n


# --- clip cutting -------------------------------------------------------------
def cut_clips(song_id: str, windows: list[dict]) -> dict:
    src = _file_for(song_id)
    if src is None:
        return {"ok": False, "clips": [], "error": "no audio file"}
    clips = []
    for w in windows[: config.CLIP_COUNT]:
        try:
            clips.append(_cut_one(src, song_id, w))
        except Exception as e:  # noqa: BLE001
            clips.append(
                {"id": str(w.get("start")), "start": w.get("start"), "end": w.get("end"), "error": str(e)}
            )
    return {"ok": bool(clips), "clips": clips, "error": None}


def _cut_one(src: Path, song_id: str, w: dict) -> dict:
    start = float(w["start"])
    end = float(w["end"])
    length = max(end - start, 1.0)
    clip_id = f"{song_id}_{int(start * 1000)}"
    out = config.CLIP_DIR / f"{clip_id}.mp3"
    fade_out = min(0.3, length / 2)
    filters = (
        f"afade=t=in:st=0:d=0.15,"
        f"afade=t=out:st={max(0.0, length - fade_out):.3f}:d={fade_out:.3f},"
        "loudnorm=I=-16:TP=-1.5:LRA=11"
    )
    _ffmpeg(
        [
            "-ss", f"{start:.3f}", "-to", f"{end:.3f}", "-i", str(src),
            "-af", filters, "-b:a", "192k", str(out),
        ]
    )
    peaks = _peaks(src, start, end, 300)
    return {
        "id": clip_id,
        "start": round(start, 2),
        "end": round(end, 2),
        "url": f"/api/clips/{clip_id}.mp3",
        "peaks": peaks,
    }


def cleanup_stale(ttl: int = config.AUDIO_TTL_SECONDS) -> int:
    now = time.time()
    removed = 0
    for d in (config.UPLOAD_DIR, config.CLIP_DIR):
        for p in d.glob("*"):
            try:
                if p.is_file() and now - p.stat().st_mtime > ttl:
                    p.unlink()
                    removed += 1
            except OSError:
                pass
    return removed
