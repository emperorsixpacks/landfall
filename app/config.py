"""Central configuration. All knobs that must be correct live here, not scattered."""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

# --- Qloo ------------------------------------------------------------------
QLOO_API_KEY = os.environ.get("QLOO_API_KEY", "")
QLOO_BASE_URL = os.environ.get(
    "QLOO_BASE_URL", "https://hackathon.api.qloo.com"
).rstrip("/")
QLOO_MODE = os.environ.get("QLOO_MODE", "live").lower()  # live | mock
QLOO_MIN_INTERVAL_SECONDS = float(os.environ.get("QLOO_RATE_LIMIT", "0.1"))
QLOO_PARAMS_FILE = ROOT / "config" / "qloo_params.yaml"

# --- LLM (OpenAI-compatible) -----------------------------------------------
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "").rstrip("/")
LLM_API_KEY = os.environ.get("LLM_API_KEY", "")
LLM_MODEL = os.environ.get("LLM_MODEL", "")

# --- Optional Google OAuth --------------------------------------------------
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI = os.environ.get("GOOGLE_REDIRECT_URI", "")
YOUTUBE_AUDIENCE_ENABLED = (
    os.environ.get("YOUTUBE_AUDIENCE_ENABLED", "false").lower() == "true"
)

# --- Spotify (artist lookup + catalog) --------------------------------------
SPOTIFY_CLIENT_ID = os.environ.get("SPOTIFY_CLIENT_ID", "")
SPOTIFY_CLIENT_SECRET = os.environ.get("SPOTIFY_CLIENT_SECRET", "")

# --- Lyrics (Groq Whisper transcription + LLM theme extraction) ---------------
LYRICS_ENABLED = os.environ.get("LYRICS_ENABLED", "true").lower() == "true"

# --- Agent ------------------------------------------------------------------
MAX_STEPS = 14
TIME_BUDGET_SECONDS = 120.0
TOOL_TIMEOUT_SECONDS = 30.0

# --- Fit score weights (sum to 1.0) ----------------------------------------
FIT_WEIGHTS = {
    "catalog": 0.40,
    "audience": 0.40,
    "hook": 0.20,
}

# --- Qloo limits ------------------------------------------------------------
QLOO_INSIGHTS_LIMIT = 20  # clamp user-specified limit
QLOO_SEARCH_LIMIT = 5

# --- Audio ------------------------------------------------------------------
MAX_UPLOAD_MB = 25
MAX_DURATION_SECONDS = 8 * 60
ANALYSIS_SR = 22050
CLIP_MIN_SECONDS = 15
CLIP_MAX_SECONDS = 30
CLIP_COUNT = 3
AUDIO_TTL_SECONDS = 60 * 60  # delete uploads after 1 hour

# --- Paths ------------------------------------------------------------------
CACHE_DIR = ROOT / "cache"
UPLOAD_DIR = ROOT / "uploads"
CLIP_DIR = Path(os.environ.get("CLIPS_DIR", str(ROOT / "clips")))
SAMPLES_DIR = ROOT / "samples"
BUNDLED_CACHE_DIR = ROOT / "cached"
FRONTEND_DIST = ROOT / "frontend" / "dist"

# Hosting hardening
MAX_CONCURRENT_RUNS = int(os.environ.get("MAX_CONCURRENT_RUNS", "3"))
RATE_LIMIT_PER_MINUTE = int(os.environ.get("RATE_LIMIT_PER_MINUTE", "10"))

for _d in (CACHE_DIR, UPLOAD_DIR, CLIP_DIR):
    _d.mkdir(parents=True, exist_ok=True)


def qloo_ready() -> bool:
    return bool(QLOO_API_KEY)


def llm_ready() -> bool:
    return bool(LLM_BASE_URL and LLM_API_KEY and LLM_MODEL)


def spotify_ready() -> bool:
    return bool(SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET)


def lyrics_ready() -> bool:
    return LYRICS_ENABLED and bool(LLM_API_KEY and LLM_BASE_URL)
