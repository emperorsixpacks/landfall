"""FastAPI app: SSE agent runs, audio upload, clip serving, and static frontend."""
from __future__ import annotations

import asyncio
import json
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import agent, audio, cities as cities_mod, config, lookup


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


async def _cleanup_loop():
    while True:
        try:
            await asyncio.to_thread(audio.cleanup_stale)
        except Exception:  # noqa: BLE001
            pass
        await asyncio.sleep(1800)  # 30 min


@app.get("/api/health")
def health():
    return {"ok": True, "qloo": config.qloo_ready(), "llm": config.llm_ready(), "mode": config.QLOO_MODE}


@app.get("/api/cities")
def get_cities():
    return cities_mod.load_cities()


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
    song_id = f"{uuid.uuid4().hex}{ext}"
    (config.UPLOAD_DIR / song_id).write_bytes(data)
    return {"song_id": song_id, "name": Path(file.filename or "upload").stem}


@app.post("/api/run")
async def run(request: Request):
    body = await request.json()
    artist = (body.get("artist") or "").strip()
    if not artist:
        raise HTTPException(400, "artist is required")

    async def gen():
        try:
            async for item in agent.run_agent(body):
                if item["type"] == "start":
                    yield _sse("start", item)
                elif item["type"] == "event":
                    yield _sse("event", item["event"])
                elif item["type"] == "final":
                    yield _sse("final", item["result"])
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


@app.get("/api/samples/{filename}")
def sample(filename: str):
    if ".." in filename or "/" in filename:
        raise HTTPException(400)
    p = config.SAMPLES_DIR / filename
    if not p.exists():
        raise HTTPException(404)
    return FileResponse(p)


# Static frontend (built by `npm run build`). Served at the end so /api wins.
if config.FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(config.FRONTEND_DIST), html=True), name="frontend")


@app.get("/{path:path}")
async def spa_fallback(path: str):
    index = config.FRONTEND_DIST / "index.html"
    if index.exists():
        return FileResponse(index)
    return JSONResponse({"detail": "frontend not built"}, status_code=404)
