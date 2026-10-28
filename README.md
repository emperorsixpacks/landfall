# Landfall

An agentic release planner for music artists, built for the Qloo Agentic Hackathon.

Pick an artist and drop in a new unreleased song. An agent uses **Qloo taste data**
to predict how well the song fits the artist's audience, which cities and
collaborators to target, and which 15–30 second section to use as the clip. A plain
LLM cannot do this because it has no audience taste data — Qloo is the core, not a
garnish.

## Architecture

```
┌──────────────┐   SSE    ┌──────────────────────────────┐
│  React + Vite │ ───────▶│  FastAPI (single service)     │
│  (Tailwind)   │          │                              │
└──────────────┘          │  agent.py   — orchestrator    │
                          │  tools.py   — tool schemas     │
                          │  qloo_client.py — Qloo API     │
                          │  lookup.py  — YouTube Music    │
                          │  audio.py   — librosa/ffmpeg   │
                          │  scoring.py — fit score (code) │
                          │  llm.py     — OpenAI-compat    │
                          └──────────────┬─────────────────┘
                                         │ X-Api-Key (GET only)
                                   ┌─────▼──────┐
                                   │ Qloo API   │  hackathon.api.qloo.com
                                   └────────────┘
```

- **Agent**: a JSON action protocol. Each turn the model returns exactly one JSON
  object (`{"tool": ..., "args": {...}, "why": "..."}` or `{"final": true}`). Code
  validates args against a schema, executes with a timeout, trims the result, and
  returns a short summary. Hard cap of 14 steps and a time budget; on invalid JSON it
  retries once, then falls back to the deterministic FINISH stage so a run never dies.
- **Code owns correctness**: argument validation, scoring, audio math, file handling,
  and the final schema. The LLM never computes the fit score.
- The scratchpad holds full results; the model only ever sees trimmed summaries.

## Tools

| Tool | What it does | Source |
|------|--------------|--------|
| `find_artist(query)` | artist name, top songs, related artists | YouTube Music (`ytmusicapi`, unofficial, no login), 24h disk cache + bundled fallback |
| `find_home_city(artist, description)` | determine the artist's origin city (globe arcs) from the YT description against `cities.json` | LLM + our city list |
| `sound_to_tags(features)` | map audio features to resolved Qloo tags (bridge) | `GET /v2/tags` + `config/bridge_rules.yaml` |
| `qloo_search(name, type)` | resolve a name to a Qloo entity (fuzzy auto-select ≥ 90) | `GET /search` |
| `qloo_insights(type, signals, filters, limit)` | ranked recommendations from taste signals | `GET /v2/insights` |
| `qloo_audience(...)` | audience taste profile (tags + demographics) | `/entities` tags + best-effort `urn:demographics` |
| `analyze_audio(song_id)` | tempo, key, energy curve, loudness, sections, hook windows | librosa + ffmpeg (CPU) |
| `cut_clips(song_id, windows)` | beat-aligned ffmpeg cuts with fades, −16 LUFS, mp3 192k | ffmpeg |
| `describe_sound(features)` | 3–5 constrained descriptors + "sounds like" comparables | LLM, comparables restricted to catalog/related/genre |
| `write_captions(clips, profile)` | one ≤120-char caption per clip | LLM |
| `score_fit(evidence)` | weighted fit score **in code** | pure Python |
| `youtube_audience(token)` | owner YouTube Analytics (optional) | feature-flagged, not built |

## Where Qloo matters

Every call below is a real Qloo query; without Qloo the agent has no taste data to
reason over.

1. **Entity resolution** — `qloo_search` maps a name to a Qloo `urn:entity:artist` id
   via `/search`. Without this stable id, no downstream signal can be anchored.
2. **Catalog taste profile** — `entity_tags` reads the artist's `tags` from
   `/entities`, and `related` returns ranked related artists from
   `/v2/insights?filter.type=urn:entity:artist&signal.interests.entities=<id>`.
   These tags and entities define what the artist's audience already likes.
3. **Audience profile** — same tags, plus best-effort age/gender affinity from
   `urn:demographics`. We label this *affinity*, never "currently listening".
4. **Comparables ("sounds like")** — the LLM proposes comparables from the catalog,
   then each is resolved in Qloo and dropped if it does not resolve, so no artist is
   invented from thin air.
5. **Market ranking** — Qloo has **no single "artist-affinity-in-city" number**. The
   honest city-level signal is the **heatmap**: `filter.type=urn:heatmap` with
   `filter.location.query=<city>` and `signal.interests.entities=<artist>`, which
   returns per-geohash `affinity_rank`. We aggregate the mean rank per city and
   label it as geographic affinity, not a listening count.
6. **Collaborators** — `related` artists from Qloo, excluding the artist themselves.
7. **Audience affinity (fit score input)** — `affinity_between` scores each resolved
   comparable against the artist via `filter.results.entities`.

## Market globe

Results render a lazy-loaded `react-globe.gl` visualization (three.js) with markets
as points sized by score, arcs from the artist's origin city to the top 5, labels for
the top 3, and a pulsing ring on the selected market. No-data markets render as hollow
gray rings and are labeled "no Qloo data" — a score is never faked. Candidate markets
come from our own `data/cities.json` (~150 cities); we never geocode through Qloo. The
artist's origin city is determined by the agent (a `find_home_city` tool that reads the
YouTube Music description against `cities.json`), not hardcoded. A flat SVG dot-map
fallback covers missing WebGL, and `prefers-reduced-motion` disables rotation, the tour,
and animated arcs.

## The fit score (code, never the LLM)

```
fit = 0.5 * catalog_match + 0.5 * audience_match
```

- `catalog_match`: Jaccard overlap of the comparables' Qloo tags vs. the artist's
  catalog profile.
- `audience_match`: Jaccard overlap of the comparables' Qloo tags vs. the audience
  profile (artist + related artists).
- `clip_strength`: the top hook window's score from audio analysis — reported
  separately, not folded into the fit.

Missing components are renormalized and flagged, and a plain-English explanation is
built from templates. Weights live in `app/scoring.py`.

## Sound-to-taste bridge

`app/bridge.py` + `config/bridge_rules.yaml` map numeric audio features (tempo, key,
energy, brightness, onset density) to search terms, resolve each through
`GET /v2/tags` (best fuzzy match only, ratio ≥ 85, unresolved terms dropped, no
invented tag ids), and feed the resolved tag ids back as `signal.interests.tags` in
the artist-comparables call and `filter.tags` in the venues call. The trace is shown
in the "Sound to taste" panel.

## Plain-LLM baseline

`POST /api/baseline` runs the same artist + song through the LLM with **no** Qloo
tools. The results page has a "Compare with plain LLM" toggle showing the ungrounded
plan next to the Qloo-grounded one.

## Qloo API rules this repo follows (from the official hackathon guide)

- Base URL `https://hackathon.api.qloo.com` only; `X-Api-Key` header only; `/v2/insights`
  is **GET** with query params. Never `/recs` or `/recommendations`.
- `filter.type` validated against `config/qloo_params.yaml` (transcribed from the
  Entity Type Parameter Guide). Unsupported parameters are dropped **before** sending
  and surfaced as warnings, because Qloo silently ignores invalid parameters.
- A process-wide rate gate + one 429 retry; every request is logged (key redacted)
  into the agent trace.
- `scripts/coverage_test.py` includes a "no-effect" check that calls with and without
  a signal and flags identical results.
- **Audiences are deprecated**: `GET /v2/audiences` (Find Audiences) and
  `GET /v2/audiences/types` are both marked `deprecated`, and `urn:entity:audience`
  is deprecated too. Audiences now only survive as the `signal.demographics.audiences`
  input signal (requires `urn:audience:*` URNs, 10 categories). We therefore do **not**
  build on the audiences lookup APIs; the audience profile uses entity tags +
  age/gender affinity instead.
- No Qloo response data is committed to the repo — the runtime cache directory is
  gitignored. The bundled `cached/` fallback contains only YouTube Music public info.

## Honest limitations

- **YouTube Music lookup is unofficial** (`ytmusicapi`, unauthenticated). It can be
  blocked from the host; we fall back to bundled data for the 3 sample artists and
  name the source in the trace.
- **Predicted fit** is a heuristic on affinity and audio features, not a streaming
  or sales forecast. It is labeled "predicted fit" and shown as a breakdown.
- **Coverage gaps** happen (an artist not in Qloo, no heatmap data for a region). The
  UI shows a data-coverage notice whenever Qloo returns nothing; nothing is invented.
- Audio features are **estimates** (no vocal detection, no lyrics extraction).
- `urn:demographics` is documented but absent from the parameter matrix, so it is
  best-effort and degrades to "no demographics" without failing the run.

## Setup

```bash
cp .env.example .env   # fill QLOO_API_KEY, LLM_*, etc.
pip install -r requirements.txt

# backend (dev)
uvicorn app.main:app --reload --port 8000

# frontend (dev, proxies /api to :8000)
cd frontend && npm install && npm run dev
```

### Mock mode (no key needed)

`QLOO_MODE=mock` routes all Qloo calls to deterministic synthetic "sample data" so
the whole app runs keyless. The UI labels mock results as sample data. Test the agent
end-to-end with `QLOO_MODE=mock python3 scripts/coverage_test.py`.

### Env vars

`QLOO_API_KEY`, `QLOO_BASE_URL`, `QLOO_MODE` (`live|mock`), `QLOO_RATE_LIMIT`,
`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, optional `GOOGLE_CLIENT_ID/SECRET/
REDIRECT_URI`, and `YOUTUBE_AUDIENCE_ENABLED`. See `.env.example`. Keys are never
logged.

## Deploy

Deploys as one Dockerized service (backend + built frontend + ffmpeg) on Render or Fly.

- Render: `render.yaml` (blueprint) is provided, or push and set
  `Dockerfile` as the build.
- Fly: `fly launch` (uses the same `Dockerfile`).

Live demo link: _(add after deploy)_

## License

MIT — see [LICENSE](LICENSE).
