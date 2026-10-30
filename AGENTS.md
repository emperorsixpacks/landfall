# AGENTS.md

Agentic music release planner (Qloo hackathon). FastAPI single service + React/Vite (Tailwind) SPA. The "agent" is a JSON action loop that calls Qloo; scoring is pure Python, never the LLM.

## Commands

Backend — serves `/api/*` AND the built frontend from `frontend/dist`:
```bash
uvicorn app.main:app --reload          # http://localhost:8000
```

Frontend dev — Vite proxies `/api` → :8000:
```bash
cd frontend && npm run dev             # http://localhost:5173
```

Build + test:
```bash
cd frontend && npm run build
cd frontend && npm test                # vitest (frontend only)
python -m unittest app.tests.test_scoring   # backend tests are unittest, NOT pytest (pytest isn't installed)
```

Smoke-test the whole agent **offline** (no keys, no Qloo/LLM calls — the main way to verify the pipeline):
```bash
QLOO_MODE=mock LLM_API_KEY= LLM_BASE_URL= LLM_MODEL= \
  python -m uvicorn app.main:app --port 8001
curl -N -X POST :8001/api/run -H 'Content-Type: application/json' \
  -d '{"artist":"Tems","countries":["Nigeria","United Kingdom"]}'
```

## Environment

`.env` (see `.env.example`): `QLOO_*`, `LLM_*` (Groq/OpenAI-compatible), `SPOTIFY_*`, `LYRICS_ENABLED`.
- `QLOO_MODE=mock` routes every Qloo call to `app/mock_data.py` (synthetic, no key/network). Use it for all local development and testing.
- `QLOO_MODE=live` hits `hackathon.api.qloo.com`.
- Python 3.12 (`.python-version`); Docker builds `python:3.12` + ffmpeg.

## Architecture

- `app/agent.py` — orchestrator. JSON action loop: model returns `{"tool":…,"args":…,"why":…}` or `{"final":true}`. `STAGE_BY_TOOL` orders stages; the deterministic `_finish` always runs, so a run never dies on a bad model turn.
- `app/tools.py` — tool schemas (`TOOL_SCHEMAS`) + handlers (`TOOLS`). `validate_args` is the arg gate; handlers mutate a shared `state` dict and return only short summaries.
- `app/scoring.py` — fit score in pure code. The real weights are `scoring.FIT_WEIGHTS` (`catalog_match` 0.5 / `audience_match` 0.5, with `clip_strength` reported separately). **`config.FIT_WEIGHTS` is stale/unused — ignore it.**
- `app/qloo_client.py` — GET-only `X-Api-Key` wrapper, process-wide rate gate (`QLOO_RATE_LIMIT`), 24h disk cache, mock short-circuit.
- `app/chat.py` — the "Ask Landfall" chat, a **separate** agent (own `CHAT_TOOL_SCHEMAS`/`CHAT_TOOLS`), read-only over a finished run.
- `app/run_store.py` — in-memory store of finished runs keyed by `run_id` (bounded, lost on restart). `/api/chat` only works against a run in the same server process.

## Streaming / SSE (easy to break)

- `/api/run` streams SSE; the frontend parses it **manually** (no `EventSource`) in `App.jsx` (`parseSSE`), handling `event`/`final`/`error`.
- The `/api/run` generator uses a producer/consumer `asyncio.Queue` (a producer task runs the agent; the consumer emits with a 15s ping). Do NOT revert to `asyncio.wait_for(anext(...))` — the timeout cancels the agent generator and drops the `final` event.
- Heavy work (librosa audio, Groq Whisper transcription, ffmpeg clips, LLM calls) must be wrapped in `asyncio.to_thread` inside the agent, or the event loop blocks and the SSE stream stalls.
- `frontend/vite.config.js` sets `Accept-Encoding: identity` on the `/api` proxy so SSE flushes; keep it.

## Markets are countries now

The release targets **countries**, not cities. The request body uses `countries` (country names). But the market object key is still `city` (it holds the country name), so globe/list/chat code is unchanged. `data/countries.json` (~51 curated) + `data/cities.json` (143). `app/cities.py` has `load_cities()` and `load_countries()`; `normalize_country_selection()` falls back to `DEFAULT_COUNTRIES`.

## Lyrics → Qloo

`app/lyrics.py`: Whisper (Groq) → LLM theme/mood/entity extraction → fuzzy-resolve themes to Qloo tags (`/v2/tags`) and entities to Qloo entities. `result.lyrics.tags`/`entities` are the resolved Qloo signals. The market heatmap passes the song's resolved tags (`signal.interests.tags`), so Qloo "sees" the lyrics. The chat injects lyric lines into the LLM context (`chat._run_summary`).

## Frontend

- SPA root `frontend/src/App.jsx` (views: home / running / results). `frontend/src/components/Results.jsx` is the report page.
- Tokens (Tailwind + `index.css`): `bg-panel`, `bg-raised`, `border-border`, `text-muted`, `accent`, `positive`, `warn`, `.num` (mono). `desktop:` breakpoint = **1100px**. Container queries live in `index.css` (`@container` + `.report-col/.fit-card/.globe-card`).
- `frontend/src/lib/globeUtils.js` — pure helpers (no three.js): `rankMarkets`, `joinMarketsToCities`, `scoreToColor`, `formatTime`, `COLORS`.
- `GlobeContainer.jsx` is `forwardRef` — `globeRef.current.flyToCity()/resetView()/saveImage()/startTour()` depend on it.
- Chat is a fixed bottom dock (`ChatDock.jsx`): open with `/` or Cmd/Ctrl+K, close with Esc.

## Notes

- `kiro.jon` is a stray transcript dump, not part of the app — ignore it.
- Conventional commits (`feat:`/`fix:`/`chore:`/`perf:`/`docs:`).
