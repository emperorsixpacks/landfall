# Landfall Terminology Design System

This document defines the canonical terminology used throughout Landfall — in code, UI, documentation, and communication. Consistent language improves comprehension, reduces ambiguity, and keeps the mental model aligned between all layers of the system.

---

## Core Principles

1. **Precision over marketing** — Use accurate, technical terms that reflect what the system actually does.
2. **Consistency across layers** — The same concept uses the same name in Python, React, API responses, and user-facing text.
3. **Honest capability** — Never imply we know more than we do. Label predictions, estimates, and best-effort data clearly.
4. **Qloo-centric** — When referencing Qloo concepts, use Qloo's canonical terms (entity, signal, affinity, insights).

---

## 1. System Identity

| Term | Definition | Usage |
|------|------------|-------|
| **Landfall** | The product name. An agentic release planner for music artists. | Product, repo name, UI header. |
| **Agent** | The JSON action loop orchestrator that calls tools, validates schemas, and assembles the final plan. | Code (`agent.py`), backend logs, trace events. |
| **Tool** | A discrete function the agent can invoke (e.g., `find_artist`, `qloo_insights`, `analyze_audio`). | Code, agent prompts, trace events. |
| **Run** | A single execution of the agent from start (artist + song input) to finish (release plan output). | UI, API endpoints (`/api/run`), user-facing. |
| **Trace** | The chronological log of tool calls, results, and decisions during a run. | Developer-facing, debugging. |

---

## 2. Agent Architecture

### Agent Loop Components

| Term | Definition | Usage |
|------|------------|-------|
| **State** | The mutable dictionary holding all accumulated data during a run (catalog, audience, audio, clips, etc.). | Code (`agent.py`), internal. |
| **Scratchpad** | Synonym for state. Full tool results are written here; the LLM only sees trimmed summaries. | Documentation, explaining the design. |
| **Stage** | A logical phase in the agent workflow (IDENTIFY, PROFILE, TARGET, LISTEN, COMPARE, BRIDGE, CLIP, FINISH). | Code (`STAGE_BY_TOOL`), trace events, UI. |
| **Decision** | The JSON object returned by the LLM each turn: `{"tool": "...", "args": {...}, "why": "..."}` or `{"final": true}`. | Code, agent logs. |
| **Step** | A single iteration of the agent loop (LLM decision → tool execution → result). Hard cap: 14. | Code, trace events. |

### Agent Stages (Canonical Order)

| Stage | Purpose | Tools |
|-------|---------|-------|
| **IDENTIFY** | Resolve the artist and their Qloo entity. | `find_artist`, `find_home_city`, `qloo_search` |
| **PROFILE** | Build the catalog and audience taste profiles. | `qloo_audience` |
| **TARGET** | Rank markets and collaborators. | `qloo_insights` |
| **LISTEN** | Analyze the audio features of the new song. | `analyze_audio` |
| **COMPARE** | Describe the sound and identify comparable artists. | `describe_sound` |
| **BRIDGE** | Map audio features to Qloo taste tags. | `sound_to_tags` |
| **CLIP** | Cut promotional clips and write captions. | `cut_clips`, `write_captions` |
| **FINISH** | Compute the fit score and assemble the final plan. | (deterministic, no tool) |

---

## 3. Music & Artist Concepts

| Term | Definition | Usage | Avoid |
|------|------------|-------|-------|
| **Artist** | The musician or band being analyzed. | Everywhere. | "Band", "musician" (unless contextually needed). |
| **Song** | The unreleased track being evaluated for release. | Everywhere. | "Track" (acceptable in technical contexts like `sample_tracks`). |
| **Catalog** | The artist's existing body of work, including top songs and related artists. | Code (`state["catalog"]`), UI. | "Discography" (too formal). |
| **Related artists** | Artists Qloo identifies as taste-adjacent to the target artist. | Code, UI ("Related"). | "Similar artists" (implies subjective judgment). |
| **Comparables** | Artists the new song "sounds like", used to anchor taste signals. | Code (`evidence["comparable_tags"]`), UI, scoring. | "Similar artists" (reserved for catalog-level relation). |
| **Top songs** | The artist's most recognized tracks (from YouTube Music). | Code, UI. | "Hits", "popular songs". |

---

## 4. Qloo Taste Graph Concepts

These terms mirror Qloo's API and documentation.

| Term | Definition | Usage | Avoid |
|------|------------|-------|-------|
| **Entity** | A resolved Qloo object (artist, place, brand, etc.) with a stable `urn:entity:*` identifier. | Code, API calls, logs. | "Item", "thing". |
| **URN** | Uniform Resource Name. Qloo's stable ID format (e.g., `urn:entity:artist:1234`). | Code, API parameters. | "ID" (too generic). |
| **Signal** | Input taste data for Qloo insights (interests, demographics, location). | Code (`signals` dict), API calls. | "Filter" (signals are inputs; filters are constraints). |
| **Insights** | Qloo's recommendation results from `/v2/insights`. | Code, API calls. | "Recommendations", "recs" (deprecated Qloo endpoint). |
| **Affinity** | Qloo's measure of taste alignment between entities or geohashes. Reported as `affinity_rank` or similarity. | Code, UI ("affinity score"). | "Match", "fit" (reserved for our computed score). |
| **Tag** | A Qloo taste descriptor (e.g., `urn:tag:pop`, `urn:tag:energetic`). | Code, API calls, bridge. | "Genre", "label" (too broad). |
| **Heatmap** | Qloo's geohash-level affinity data for a location filter. | Code, market scoring. | "Map", "geographic data". |
| **Demographics** | Age and gender affinity data (best-effort, via `urn:demographics`). | Code, audience profile. | "Audience data" (too broad). |

**Important:** Qloo audiences (`/v2/audiences`) are deprecated. We build audience profiles from entity tags + demographics, not the audiences API.

---

## 5. Audio & Sound Terminology

| Term | Definition | Usage | Avoid |
|------|------------|-------|-------|
| **Audio features** | Numeric characteristics extracted via librosa (tempo, key, energy, brightness, onset density). | Code (`audio.py`), bridge, tool results. | "Metadata" (implies tags, not features). |
| **Hook window** | A 15–30 second segment scored for promotional potential (high energy variance, structural position). | Code (`audio.analyze`), UI. | "Clip candidate", "highlight". |
| **Clip** | A final beat-aligned mp3 cut from a hook window, normalized to −16 LUFS. | Code (`state["clips"]`), UI, results. | "Preview", "snippet". |
| **Clip strength** | The hook score of the top clip (0–100), reported separately from the fit score. | Code (`scoring.py`), results. | "Clip score" (ambiguous). |
| **Tempo** | Beats per minute (BPM). | Code, audio features. | "Speed". |
| **Key** | Musical key (e.g., C major, A minor). | Code, audio features. | "Pitch" (inaccurate). |
| **Energy curve** | Frame-by-frame RMS energy over time. | Code, audio analysis. | "Loudness curve" (energy ≠ loudness). |
| **Onset density** | Average note/transient events per second. | Code, bridge rules. | "Rhythm density". |
| **Brightness** | Spectral centroid, measuring high-frequency content. | Code, bridge rules. | "Tone", "timbre" (broader). |

---

## 6. Fit Score & Evaluation

The **fit score** is Landfall's core output: a heuristic prediction of how well the new song aligns with the artist's audience taste profile.

| Term | Definition | Usage | Avoid |
|------|------------|-------|-------|
| **Fit score** (or **fit**) | Weighted blend of catalog match + audience match (0–100). **Code-computed, never the LLM.** | Code (`scoring.py`), UI, results. | "Match score", "affinity score" (Qloo's term). |
| **Catalog match** | Jaccard overlap (0–100) between comparable tags and the artist's catalog profile tags. | Code, results breakdown. | "Catalog fit". |
| **Audience match** | Jaccard overlap (0–100) between comparable tags and the audience profile tags. | Code, results breakdown. | "Audience fit". |
| **Clip strength** | Reported alongside fit but **not** folded in. Measures the top hook window's promotional potential. | Code, results. | "Hook score". |
| **Evidence** | The dict of inputs to `score_fit`: `comparable_tags`, `catalog_tags`, `audience_tags`, `hooks`. | Code (`scoring.py`). | "Signals" (Qloo term). |
| **Breakdown** | Per-component scores shown to the user (catalog match, audience match, clip strength). | Code, UI. | "Details". |
| **Warning** | A notice that a score component was unavailable (e.g., "catalog match unavailable"). | Code, results. | "Error" (warnings don't fail the run). |

**Weights:** `catalog_match: 0.5`, `audience_match: 0.5` (configurable in `scoring.py`).

**Renormalization:** If a component is missing, the weights of present components are scaled to sum to 1.

---

## 7. Markets & Geography

| Term | Definition | Usage | Avoid |
|------|------------|-------|-------|
| **Market** | A city being evaluated for release targeting (e.g., Los Angeles, Tokyo). | Code, UI, results. | "City" (when referring to the targeting context). |
| **Origin city** (or **home city**) | The artist's determined base location, used as the globe arc origin. | Code (`state["origin"]`), UI. | "Hometown" (implies personal residence). |
| **Market score** | Aggregate affinity rank for a market, derived from Qloo heatmap data. Lower rank = stronger affinity. | Code, UI. | "City score". |
| **Globe arc** | Visual line from the origin city to a target market on the 3D globe. | UI, visualization. | "Connection", "link". |
| **No data** | A market with no Qloo heatmap results. Rendered as a hollow gray ring on the globe. | UI, results. | "Unknown", "missing" (ambiguous). |
| **Candidate cities** | The subset of cities (from `cities.json`) the user selected for evaluation. | Code, API. | "Selected markets". |

**Source of truth:** `data/cities.json` (~150 cities with lat/lon). We never geocode through Qloo.

---

## 8. User-Facing (UI & Results)

| Term | Definition | Usage | Avoid |
|------|------------|-------|-------|
| **Release plan** | The final output: fit score, top markets, collaborators, clips, and captions. | UI, results page. | "Report", "analysis". |
| **Predicted fit** | User-facing label for the fit score, emphasizing it is a heuristic prediction, not a guarantee. | UI. | "Match", "score" (alone). |
| **Coverage notice** | A message shown when Qloo returns no data for a query (e.g., artist not in Qloo, no heatmap data). | UI. | "Error", "warning". |
| **Mock mode** (or **sample data**) | `QLOO_MODE=mock`. Routes all Qloo calls to synthetic deterministic data for keyless testing. | UI, logs, `.env`. | "Demo mode", "test mode". |
| **Live mode** | `QLOO_MODE=live`. Uses the real Qloo API. | UI, logs. | "Production mode". |
| **Baseline** | A plain LLM plan (no Qloo tools), used for comparison. Accessible via "Compare with plain LLM" toggle. | UI, API (`/api/baseline`). | "Ungrounded", "no-tool". |
| **Timeline** | The vertical event stream shown during a run (tool calls, markets scored, stage transitions). | UI (`RunTimeline.jsx`). | "Log", "trace" (developer terms). |

---

## 9. Bridge & Sound-to-Taste Mapping

The **bridge** maps numeric audio features to resolved Qloo taste tags, enabling audio-driven insights.

| Term | Definition | Usage | Avoid |
|------|------------|-------|-------|
| **Bridge** | The audio-to-taste mapping system (`bridge.py` + `bridge_rules.yaml`). | Code, architecture docs. | "Mapper", "translator". |
| **Bridge rules** | YAML rules mapping feature ranges (tempo, energy, brightness) to search terms. | Code, config. | "Mapping rules". |
| **Search term** | A plain-text descriptor (e.g., "energetic", "upbeat") fed to Qloo's `/v2/tags` search. | Code, bridge. | "Keyword". |
| **Resolved tag** | A Qloo `urn:tag:*` returned from fuzzy search (ratio ≥ 85). Unresolved terms are dropped. | Code, bridge. | "Matched tag". |
| **Bridge trace** | The logged sequence of feature → search term → resolved tag, shown in the UI "Sound to taste" panel. | Code, UI. | "Mapping log". |

**Never invent tag URNs.** Only use tags Qloo returns from `/v2/tags`.

---

## 10. Technical & Infrastructure

| Term | Definition | Usage | Avoid |
|------|------------|-------|-------|
| **YouTube Music lookup** | Unofficial artist data fetched via `ytmusicapi` (unauthenticated). | Code (`lookup.py`), docs. | "YouTube API" (implies official). |
| **Fallback data** | Bundled JSON in `cached/ytmusic_fallback.json` used when YouTube Music is unreachable. | Code, docs. | "Cached data" (cache is runtime). |
| **Rate gate** | Process-wide request limiter for Qloo API calls. | Code (`qloo_client.py`). | "Rate limiter" (gate is more specific). |
| **Cache** | Runtime disk cache (24h TTL) for Qloo and YouTube Music responses. `cache/` directory. | Code, `.gitignore`. | "Storage". |
| **SSE** (Server-Sent Events) | The streaming protocol used for `/api/run` (agent → frontend). | Code (`main.py`), backend. | "WebSocket" (incorrect). |
| **Deterministic FINISH** | The final fallback stage that runs even if the LLM fails, ensuring every run produces a result. | Code, architecture. | "Fallback stage". |

---

## 11. Data Coverage & Honesty Labels

When Qloo returns no data, we **never fake results**. Use these terms consistently:

| Situation | Label | Usage |
|-----------|-------|-------|
| Artist not in Qloo | "Artist not found in Qloo" | UI, trace. |
| No heatmap data for a city | "No Qloo data" | UI (globe label). |
| Tag search returns no results | "Unresolved" | Bridge trace. |
| Demographics unavailable | "No demographics" | Audience profile. |
| Audio analysis fails | "Audio unavailable" | Fit score warning. |

**General pattern:** "`<Component>` unavailable" or "No Qloo data".

---

## 12. Anti-Patterns (What NOT to Say)

| ❌ Avoid | ✅ Use Instead | Reason |
|---------|---------------|--------|
| "Predict streams/sales" | "Predict fit" | We predict taste alignment, not commercial outcomes. |
| "Guaranteed success" | "Predicted fit" | Fit score is a heuristic, not a guarantee. |
| "Qloo knows who's listening" | "Qloo affinity data" | Qloo provides taste affinity, not listener counts. |
| "Best markets" | "Top markets" | Avoids overpromising. |
| "Perfect match" | "High fit" / "Strong match" | No score is perfect. |
| "Real-time data" | "Qloo taste graph" | Qloo data is near-real-time but not live. |
| "Analyze vocals/lyrics" | "Analyze audio features" | We don't extract vocals or lyrics. |
| "Audiences API" | "Audience profile" | Qloo audiences endpoint is deprecated. |

---

## 13. Code Naming Conventions

### Python (Backend)

- **Modules:** `snake_case` (e.g., `qloo_client.py`, `audio.py`)
- **Functions:** `snake_case` (e.g., `find_artist`, `score_fit`)
- **Classes:** `PascalCase` (rare in this project; we use dicts)
- **State keys:** `snake_case` (e.g., `state["artist_name"]`, `state["clips"]`)
- **Tool names:** `snake_case`, match function names (e.g., `"find_artist"`)
- **Stage names:** `SCREAMING_SNAKE_CASE` (e.g., `"IDENTIFY"`, `"FINISH"`)

### JavaScript (Frontend)

- **Components:** `PascalCase` (e.g., `Home.jsx`, `RunTimeline.jsx`)
- **Functions/variables:** `camelCase` (e.g., `liveMarkets`, `parseSSE`)
- **CSS classes:** `kebab-case` (Tailwind utilities, custom classes)

### API & JSON

- **Endpoints:** `/api/snake_case` (e.g., `/api/run`, `/api/baseline`)
- **JSON keys:** `snake_case` (e.g., `{"artist_name": "...", "fit_score": 85}`)
- **Event types:** `snake_case` (e.g., `{"type": "tool_call"}`, `{"type": "market_scored"}`)

---

## 14. Voice & Tone

### In Code & Logs
- **Precise and technical.** Use exact terms from this doc.
- **Terse but clear.** Short variable names are fine if obvious in context (e.g., `cm` for catalog match in scoring).

### In the UI
- **Concise and confident, but honest.** Show the data we have; never invent.
- **Plain language.** "Predicted fit" instead of "heuristic composite score".
- **Informative, not marketing.** "No Qloo data" instead of "Coming soon".

### In Documentation
- **Structured and exhaustive.** Assume the reader wants full detail.
- **Honest about limitations.** Upfront about unofficial APIs, best-effort fields, and gaps.

---

## 15. Updating This Document

This terminology system is **source of truth**. When introducing new concepts:

1. Add the term to the relevant section above.
2. Update code, UI, and docs to match.
3. If renaming an existing term, grep the codebase and update all usages.

**Consistency is non-negotiable.** Ambiguous terminology creates bugs and user confusion.

---

## Quick Reference: Most Common Terms

| Concept | Canonical Term |
|---------|----------------|
| The product | Landfall |
| A single execution | Run |
| The orchestrator | Agent |
| What the agent calls | Tool |
| Phases of work | Stage |
| The unreleased track | Song |
| The musician | Artist |
| Existing work | Catalog |
| Song sounds like | Comparables |
| Qloo object | Entity |
| Qloo ID | URN |
| Qloo recommendations | Insights |
| Qloo taste measure | Affinity |
| Our computed score | Fit (score) |
| Fit components | Catalog match, audience match |
| Hook quality | Clip strength |
| A final cut | Clip |
| A city being evaluated | Market |
| Artist's base | Origin city |
| Audio numbers | Audio features |
| Audio → taste | Bridge |
| No Qloo results | No data / unavailable |

---

**End of Terminology Design System**
