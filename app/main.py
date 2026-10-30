"""FastAPI app: SSE agent runs, audio upload, clip serving, and static frontend."""
from __future__ import annotations

import asyncio
import json
import time
import uuid
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import agent, audio, baseline as baseline_mod, chat, cities as cities_mod, config, lookup, qloo_client as qloo, run_store


@asynccontextmanager
async def _lifespan(app: FastAPI):
    task = asyncio.create_task(_cleanup_loop())
    yield
    task.cancel()


app = FastAPI(title="Landfall", lifespan=_lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

ALLOWED_EXT = {".mp3", ".wav", ".m4a"}

# Hosting hardening: concurrency cap + per-IP rate limit.
_run_semaphore = asyncio.Semaphore(config.MAX_CONCURRENT_RUNS)
_ip_requests: dict[str, deque] = defaultdict(deque)
_chat_semaphore = asyncio.Semaphore(2)
_chat_requests: dict[str, deque] = defaultdict(deque)
CHAT_RATE_LIMIT_PER_MINUTE = 10


def _chat_rate_limited(ip: str) -> bool:
    now = time.monotonic()
    q = _chat_requests[ip]
    while q and q[0] < now - 60:
        q.popleft()
    if len(q) >= CHAT_RATE_LIMIT_PER_MINUTE:
        return True
    q.append(now)
    return False

# Upload magic bytes (lenient per-format signatures).
_MAGIC = {
    ".mp3": (b"ID3", b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"),
    ".wav": (b"RIFF",),
    ".m4a": (b"ftyp",),
}


async def _cleanup_loop():
    while True:
        try:
            await asyncio.to_thread(audio.cleanup_stale)
        except Exception:  # noqa: BLE001
            pass
        await asyncio.sleep(1800)  # 30 min


def _rate_limited(ip: str) -> bool:
    now = time.monotonic()
    q = _ip_requests[ip]
    while q and q[0] < now - 60:
        q.popleft()
    if len(q) >= config.RATE_LIMIT_PER_MINUTE:
        return True
    q.append(now)
    return False


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


@app.get("/api/health")
def health():
    return {"ok": True, "qloo": config.qloo_ready(), "llm": config.llm_ready(), "mode": config.QLOO_MODE}


@app.get("/api/cities")
def get_cities():
    return cities_mod.load_cities()


@app.get("/api/countries")
def get_countries():
    return cities_mod.load_countries()


@app.get("/api/artists/search")
def search_artists(q: str = ""):
    return lookup.search_artists(q)


@app.get("/api/config")
def get_config():
    return {
        "mode": config.QLOO_MODE,
        "sample_artists": lookup.bundled_artists() or ["Burna Boy", "Tems", "Rema"],
        "sample_tracks": _sample_tracks(),
        "youtube_audience_enabled": config.YOUTUBE_AUDIENCE_ENABLED,
    }


def _sample_tracks() -> list[dict]:
    out = []
    for p in sorted(config.SAMPLES_DIR.glob("*")):
        if p.is_file() and p.suffix.lower() in ALLOWED_EXT:
            out.append({"song_id": p.name, "name": p.stem})
    return out


@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(400, "unsupported file type; use mp3, wav, or m4a")
    data = await file.read()
    if len(data) > config.MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(413, f"file exceeds {config.MAX_UPLOAD_MB} MB")
    if not _looks_like_audio(ext, data):
        raise HTTPException(400, "file content does not match its extension")
    song_id = f"{uuid.uuid4().hex}{ext}"
    (config.UPLOAD_DIR / song_id).write_bytes(data)
    return {"song_id": song_id, "name": Path(file.filename or "upload").stem}


def _looks_like_audio(ext: str, data: bytes) -> bool:
    if ext == ".m4a":
        return len(data) > 8 and data[4:8] == b"ftyp"
    return any(data.startswith(m) for m in _MAGIC.get(ext, ()))


@app.post("/api/run")
async def run(request: Request):
    if _rate_limited(_client_ip(request)):
        raise HTTPException(429, "rate limit exceeded")
    body = await request.json()
    artist = (body.get("artist") or "").strip()
    if not artist:
        raise HTTPException(400, "artist is required")

    async def gen():
        if _run_semaphore.locked():
            yield _sse("error", {"message": "server busy, try again shortly"})
            return
        run_id = uuid.uuid4().hex
        async with _run_semaphore:
            q: asyncio.Queue = asyncio.Queue()

            async def produce():
                try:
                    async for item in agent.run_agent(body):
                        await q.put(item)
                except Exception as e:  # noqa: BLE001
                    await q.put({"type": "error", "message": str(e)})
                finally:
                    await q.put(None)

            producer = asyncio.create_task(produce())
            try:
                while True:
                    try:
                        item = await asyncio.wait_for(q.get(), timeout=15)
                    except asyncio.TimeoutError:
                        yield ": ping\n\n"
                        continue
                    if item is None:
                        break
                    if item.get("type") == "final":
                        result = item.get("result") or {}
                        result["run_id"] = run_id
                        run_store.put(run_id, result, run_store.jsonable(item.get("state") or {}))
                        yield _sse("final", result)
                    elif item.get("type") == "start":
                        yield _sse("start", {"summary": item.get("summary"), "run_id": run_id})
                    elif item.get("type") == "error":
                        yield _sse("error", {"message": item.get("message")})
                    else:
                        yield _sse(item["type"], item.get("event") or item.get("result") or item.get("summary"))
            finally:
                if not producer.done():
                    producer.cancel()

    return StreamingResponse(gen(), media_type="text/event-stream")


@app.post("/api/baseline")
async def baseline_endpoint(request: Request):
    if _rate_limited(_client_ip(request)):
        raise HTTPException(429, "rate limit exceeded")
    body = await request.json()
    if not (body.get("artist") or "").strip():
        raise HTTPException(400, "artist is required")
    return await asyncio.to_thread(baseline_mod.run_baseline, body)


@app.post("/api/chat")
async def chat_endpoint(request: Request):
    if _chat_rate_limited(_client_ip(request)):
        raise HTTPException(429, "too many questions, try again in a minute")
    body = await request.json()
    run_id = body.get("run_id")
    message = (body.get("message") or "").strip()
    if not run_id:
        raise HTTPException(400, "run_id is required")
    if not message and not body.get("context"):
        raise HTTPException(400, "message is required")

    async def gen():
        if _chat_semaphore.locked():
            yield _sse("error", {"message": "chat busy, try again shortly"})
            return
        async with _chat_semaphore:
            chat_gen = chat.run_chat(body)
            try:
                async for item in chat_gen:
                    if item["type"] == "error":
                        yield _sse("error", {"message": item["message"]})
                    else:
                        yield _sse(item["type"], item)
            except Exception as e:  # noqa: BLE001
                yield _sse("error", {"message": str(e)})

    return StreamingResponse(gen(), media_type="text/event-stream")


def _sse(event: str, data) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


@app.get("/api/clips/{filename}")
def clip(filename: str):
    if ".." in filename or "/" in filename:
        raise HTTPException(400)
    p = config.CLIP_DIR / filename
    if not p.exists():
        raise HTTPException(404)
    return FileResponse(p, media_type="audio/mpeg")


@app.get("/api/audio/{song_id}")
def audio_file(song_id: str):
    if ".." in song_id or "/" in song_id:
        raise HTTPException(400)
    p = audio._file_for(song_id)
    if p is None:
        raise HTTPException(404)
    return FileResponse(p)


@app.get("/api/samples/{filename}")
def sample(filename: str):
    if ".." in filename or "/" in filename:
        raise HTTPException(400)
    p = config.SAMPLES_DIR / filename
    if not p.exists():
        raise HTTPException(404)
    return FileResponse(p)


@app.get("/api/city-score")
async def city_score(request: Request, artist_id: str = "", city: str = ""):
    if _rate_limited(_client_ip(request)):
        raise HTTPException(429, "rate limit exceeded")
    if not artist_id.strip() or not city.strip():
        raise HTTPException(400, "artist_id and city are required")
    hm = await asyncio.to_thread(qloo.heatmap, artist_id.strip(), city.strip())
    if hm["ok"] and hm["aggregate"]:
        agg = hm["aggregate"]
        score = round(agg["mean_affinity_rank"] * 100, 1)
        reason = "Fans of this artist over-index here relative to the average audience."
        return {"city": city, "score": score, "reason": reason, "status": "scored"}
    reason = f"No geographic affinity data for {city}." + (f" ({hm['error']})" if hm.get("error") else "")
    return {"city": city, "score": None, "reason": reason, "status": "no_data"}


# Static frontend (built by `npm run build`). Served at the end so /api wins.
if config.FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(config.FRONTEND_DIST), html=True), name="frontend")


@app.get("/{path:path}")
async def spa_fallback(path: str):
    index = config.FRONTEND_DIST / "index.html"
    if index.exists():
        return FileResponse(index)
    return JSONResponse({"detail": "frontend not built"}, status_code=404)
