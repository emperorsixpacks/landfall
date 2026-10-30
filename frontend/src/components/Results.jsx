import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import GlobeContainer from "./GlobeContainer.jsx";
import MarketList from "./MarketList.jsx";
import SoundToTaste from "./SoundToTaste.jsx";
import AskButton from "./AskButton.jsx";
import ChatDock from "./ChatDock.jsx";
import LyricsPanel from "./LyricsPanel.jsx";
import { AskContext } from "../lib/askContext.js";
import { useCountUp, useReducedMotion } from "../hooks/useMotion";
import {
  COLORS,
  formatKey,
  formatTime,
  generateReleaseStrategyMarkdown,
  hasVenueCoordinates,
  joinMarketsToCountries,
  rankMarkets,
  scoreToColor,
} from "../lib/globeUtils";

export default function Results({ result, events = [], countries = [], error, onReset, onEdit }) {
  const [selectedCountry, setSelectedCountry] = useState(null);
  const [hoveredCountry, setHoveredCountry] = useState(null);
  const [toggles, setToggles] = useState({ markets: true, arcs: true, venues: true });
  const [copiedReport, setCopiedReport] = useState(false);
  const [showBaseline, setShowBaseline] = useState(false);
  const [baseline, setBaseline] = useState(null);
  const [askRequest, setAskRequest] = useState(null);
  const [pendingCountries, setPendingCountries] = useState(new Set());
  const [extraScores, setExtraScores] = useState({});
  const globeRef = useRef(null);

  const askAbout = useCallback((context, question) => setAskRequest({ context, question }), []);

  const joinedMarkets = useMemo(
    () => joinMarketsToCountries(result?.markets || [], countries),
    [result?.markets, countries]
  );
  const enrichedMarkets = useMemo(() => {
    if (!Object.keys(extraScores).length) return joinedMarkets;
    return joinedMarkets.map((m) =>
      extraScores[m.country] ? { ...m, ...extraScores[m.country] } : m
    );
  }, [joinedMarkets, extraScores]);
  const ranked = useMemo(() => rankMarkets(enrichedMarkets), [enrichedMarkets]);
  const venuesAvailable = hasVenueCoordinates(enrichedMarkets);
  const selected = ranked.find((m) => m.country === selectedCountry) || null;

  function handleSelect(country) {
    setSelectedCountry((prev) => (prev === country ? null : country));
    // Fly to country — use ranked (scored) entry first, fall back to raw countries list for gray dots
    const m = ranked.find((x) => x.country === country) || countries.find((x) => x.country === country);
    if (m) globeRef.current?.flyToCountry(m);

    // Lazy-fetch score for no-data or unknown countries
    const rankedEntry = ranked.find((x) => x.country === country);
    const alreadyScored = rankedEntry && rankedEntry.score != null;
    const alreadyFetched = extraScores[country] !== undefined;
    const isPending = pendingCountries.has(country);
    if (!alreadyScored && !alreadyFetched && !isPending) {
      const artistId = result?.audience_profile?.entities?.[0]?.id;
      if (!artistId) return;
      setPendingCountries((prev) => new Set([...prev, country]));
      fetch(`/api/country-score?artist_id=${encodeURIComponent(artistId)}&country=${encodeURIComponent(country)}`)
        .then((r) => r.json())
        .then((data) => {
          setExtraScores((prev) => ({ ...prev, [country]: data }));
        })
        .catch(() => {
          setExtraScores((prev) => ({ ...prev, [country]: { country, score: null, reason: "Fetch failed.", status: "no_data" } }));
        })
        .finally(() => {
          setPendingCountries((prev) => { const s = new Set(prev); s.delete(country); return s; });
        });
    }
  }

  function saveImage() {
    const url = globeRef.current?.saveImage();
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `landfall-${(result?.artist || "globe").toLowerCase().replace(/\s+/g, "-")}.png`;
    a.click();
  }

  async function copyReport() {
    const md = generateReleaseStrategyMarkdown(result);
    try {
      await navigator.clipboard.writeText(md);
      setCopiedReport(true);
      setTimeout(() => setCopiedReport(false), 2000);
    } catch {}
  }

  if (!result) {
    return (
      <div className="space-y-4">
        <p className="text-red-400 text-sm">{error || "No result returned."}</p>
        <button
          onClick={onReset}
          className="rounded-md border border-border px-4 py-2 text-sm text-muted hover:text-text"
        >
          Back
        </button>
      </div>
    );
  }

  const coverageGap =
    (result.audience_profile?.tags?.length || 0) === 0 ||
    (result.markets || []).every((m) => m.score == null);

  const audio = result.audio_features || {};

  const bridgeTrace = result.bridge?.trace || [];
  const bridgeAttempted = new Set(bridgeTrace.map((t) => t.search_term).filter(Boolean)).size;
  const bridgeMatched = new Set(bridgeTrace.map((t) => t.qloo_tag_id).filter(Boolean)).size;
  const agentDecisions = (result.trace || []).filter((e) => e.source === "agent").length;
  const systemSteps = (result.trace || []).length - agentDecisions;
  const qlooCalls = (result.qloo_calls || []).length;

  const hasLyrics = result.lyrics && (result.lyrics.segments?.length > 0 || result.lyrics.themes?.length > 0 || result.lyrics.tags?.length > 0);
  const topSongTitles = (result.catalog?.top_songs || []).map((s) => s.title).filter(Boolean).slice(0, 5);

  async function compareBaseline() {
    setShowBaseline(true);
    setBaseline(null);
    try {
      const r = await fetch("/api/baseline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artist: result.artist, song_id: result.song, countries: (result.markets || []).map((m) => m.country) }),
      });
      if (r.ok) setBaseline(await r.json());
    } catch {}
  }

  return (
    <AskContext.Provider value={askAbout}>
      <div>
      {/* Header */}
      <div className="flex flex-wrap items-baseline justify-between gap-4 border-b border-border pb-5">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight text-text">
              {result.artist}
            </h1>
            {result.data_mode === "mock" && (
              <span className="rounded-md border border-border px-2 py-1 text-2xs uppercase tracking-wider text-muted num">
                sample data
              </span>
            )}
            {result.origin?.city && (
              <span className="text-sm text-muted">
                Origin: <span className="text-text font-medium">{result.origin.city}</span>
              </span>
            )}
          </div>
          <p className="mt-2 text-sm text-text-secondary">
            {result.song_name ? (
              <>Sample track: <span className="text-text font-medium">{result.song_name}</span></>
            ) : (
              "Acoustic audio omitted (plan only)"
            )}
          </p>
          {topSongTitles.length > 0 && (
            <p className="mt-1 truncate text-small text-muted">
              Top: {topSongTitles.join(" · ")}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={compareBaseline}
            className="rounded-lg border border-border-light bg-surface px-4 py-2 text-sm text-text-secondary hover:border-accent hover:text-text transition-all focus:outline-none focus:ring-2 focus:ring-accent"
          >
            Compare with plain LLM
          </button>
          <button
            onClick={copyReport}
            className="rounded-lg border border-border-light bg-surface px-4 py-2 text-sm text-text-secondary hover:border-accent hover:text-text transition-all focus:outline-none focus:ring-2 focus:ring-accent"
          >
            {copiedReport ? "Copied report" : "Copy report"}
          </button>
          <button
            onClick={onReset}
            className="rounded-lg border border-border-light bg-surface px-4 py-2 text-sm text-text-secondary hover:text-text transition-all focus:outline-none focus:ring-2 focus:ring-accent"
          >
            New run
          </button>
        </div>
      </div>

      <VerdictBanner result={result} ranked={ranked} onEdit={onEdit} />
      {showBaseline && <BaselineModal result={result} baseline={baseline} onClose={() => setShowBaseline(false)} />}

      <SectionNav />

      <div className={hasLyrics ? "grid grid-cols-1 desktop:grid-cols-[minmax(0,1fr)_400px] items-start gap-6" : ""}>
        <div className="report-col min-w-0 space-y-6">

      {coverageGap && (
        <div className="rounded-lg border border-warning-subtle bg-warning-subtle/30 p-4 text-sm text-text-secondary leading-relaxed">
          Data coverage note: Qloo returned limited signals for certain tags or countries.
          Missing components were renormalized out of the fit score and flagged below — nothing is fabricated.
        </div>
      )}

      {/* Top row: Fit + Globe */}
      <div className="top-row">
        <section id="section-fit" className="fit-card rounded-xl border border-border bg-panel p-5 shadow-soft">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Predicted fit</h2>
            <AskButton context={{ type: "fit", label: "fit score" }} question="What drove the fit score?" />
          </div>
          <FitGauge score={result.fit_score} />
          <div className="space-y-3">
            <FitRow label="Catalog match" caption="The song's comparables vs the artist's catalog profile" value={result.breakdown?.catalog_match} />
            <FitRow label="Audience match" caption="The song's comparables vs the audience taste profile" value={result.breakdown?.audience_match} />
            <FitRow label="Clip strength" caption="Peak energy of the strongest 15–30 second window" value={result.clip_strength} />
          </div>
        </section>

        <section id="section-markets" className="globe-card rounded-xl border border-border bg-panel p-5 shadow-soft space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Target countries</h2>
            <div className="flex items-center gap-3 text-xs text-muted">
              <Toggle label="Markets" checked={toggles.markets} onChange={(v) => setToggles((t) => ({ ...t, markets: v }))} />
              <Toggle label="Arcs" checked={toggles.arcs} disabled={!result.origin} onChange={(v) => setToggles((t) => ({ ...t, arcs: v }))} />
              <Toggle
                label="Venues"
                checked={toggles.venues}
                disabled={!venuesAvailable}
                note={venuesAvailable ? null : "unavailable"}
                onChange={(v) => setToggles((t) => ({ ...t, venues: v }))}
              />
              <button
                onClick={() => globeRef.current?.startTour()}
                className="rounded border border-border px-2 py-0.5 hover:text-text"
              >
                Tour
              </button>
              <button
                onClick={saveImage}
                className="rounded border border-border px-2 py-0.5 hover:text-text"
              >
                Save image
              </button>
              <button
                onClick={() => { globeRef.current?.resetView(); setSelectedCountry(null); }}
                className="rounded border border-border px-2 py-0.5 hover:text-text"
              >
                Reset view
              </button>
            </div>
          </div>

          <div className="globe-body">
            <div className="rounded-md overflow-hidden" style={{ minHeight: 480 }}>
              <GlobeContainer
                ref={globeRef}
                markets={enrichedMarkets}
                origin={result.origin}
                selectedCountry={selectedCountry}
                hoveredCountry={hoveredCountry}
                onSelect={handleSelect}
                onHover={setHoveredCountry}
                showMarkets={toggles.markets}
                showArcs={toggles.arcs}
                showVenues={toggles.venues}
                allCountries={countries}
                height={480}
              />
            </div>

            <div className="max-h-[440px] overflow-hidden rounded-md border border-border">
              <MarketList
                markets={enrichedMarkets}
                selectedCountry={selectedCountry}
                hoveredCountry={hoveredCountry}
                onSelect={handleSelect}
                onHover={setHoveredCountry}
              />
            </div>
          </div>

          <Legend />

          {selected && (
            <MarketDetail
              market={selected}
              collaborators={result.collaborators || []}
              isPending={pendingCountries.has(selectedCountry)}
              onClose={() => setSelectedCountry(null)}
            />
          )}
        </section>
      </div>

      {/* Summary strip */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-xl border border-border bg-panel px-5 py-3 text-small text-secondary">
        <span className="num">{agentDecisions} agent decisions</span>
        <span className="num">{systemSteps} system steps</span>
        <span className="num">{qlooCalls} Qloo calls</span>
        <span className="num">{bridgeMatched} of {bridgeAttempted} tags matched</span>
      </div>

      {/* Audio features */}
      <section id="section-sound" className="rounded-xl border border-border bg-panel p-5 space-y-4 shadow-soft">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Audio features</h2>
          <span className="num text-2xs text-muted/60">librosa · ffmpeg</span>
        </div>

        <div className="metric-tiles">
          <div className="rounded-lg bg-raised p-3">
            <span className="text-2xs uppercase text-muted tracking-wider block">Tempo</span>
            <span className="num text-xl font-semibold text-text">
              {audio.tempo ? `${Math.round(audio.tempo)}` : "—"}
            </span>
            <span className="text-xs text-muted ml-1">BPM</span>
            {result.tempo_band && (
              <span className="block text-xs text-muted mt-1">{result.tempo_band}</span>
            )}
          </div>

          <div className="rounded-lg bg-raised p-3">
            <span className="text-[10px] uppercase text-muted tracking-wider block">Key</span>
            <span className="text-sm font-semibold text-text block mt-0.5">
              {formatKey(audio.key, audio.mode)}
            </span>
            {audio.key_confidence && (
              <span className="text-[11px] num text-muted">
                {Math.round(audio.key_confidence * 100)}% conf
              </span>
            )}
          </div>

          <div className="rounded-lg bg-raised p-3">
            <span className="text-[10px] uppercase text-muted tracking-wider block">Loudness</span>
            <span className="num text-lg font-semibold text-text">
              {audio.loudness_lufs ?? "-16.0"}
            </span>
            <span className="text-[11px] text-muted ml-1">LUFS</span>
          </div>

          <div className="rounded-lg bg-raised p-3">
            <span className="text-[10px] uppercase text-muted tracking-wider block">Energy</span>
            <span className="text-sm font-semibold text-text block mt-0.5">
              {result.energy_band || "Moderate"}
            </span>
          </div>
        </div>

        {result.descriptors?.length > 0 && (
          <div className="space-y-1.5 pt-1">
            <span className="text-[10px] uppercase tracking-wider text-muted font-medium">Sound descriptors</span>
            <div className="flex flex-wrap gap-1.5">
              {result.descriptors.map((d) => (
                <span
                  key={d}
                  className="rounded-full border border-border bg-raised px-2.5 py-0.5 text-xs text-muted"
                >
                  {d}
                </span>
              ))}
            </div>
          </div>
        )}

        {audio.sections?.length > 0 && (
          <div className="space-y-1 pt-1">
            <span className="text-[10px] uppercase tracking-wider text-muted font-medium">Song structure</span>
            <div className="flex h-4 w-full overflow-hidden rounded bg-raised border border-border">
              {audio.sections.map((sec, idx) => (
                <div
                  key={idx}
                  title={`${sec.label}: ${sec.start}s–${sec.end}s`}
                  className="flex items-center justify-center text-[9px] font-mono border-r border-border/60 text-muted hover:text-text transition-colors"
                  style={{ flex: Math.max(1, (sec.end || 0) - (sec.start || 0)) }}
                >
                  {sec.label}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Sound-to-taste bridge */}
      <section id="section-bridge" className="rounded-xl border border-border bg-panel p-5 shadow-soft space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Sound to taste</h2>
        <SoundToTaste bridge={result.bridge} />
      </section>

      {/* Lyrics → Qloo */}
      <LyricsToQloo lyrics={result.lyrics} />

      {/* Audience profile & demographics */}
      <section id="section-audience" className="rounded-xl border border-border bg-panel p-5 shadow-soft space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Audience profile</h2>
          <AskButton context={{ type: "audience", label: "audience" }} question="What does the audience affinity show?" />
        </div>
        <AudienceProfile profile={result.audience_profile} />
      </section>

      {/* Discography (Spotify) */}
      {result.catalog?.albums?.length > 0 && (
        <Discography catalog={result.catalog} />
      )}

      {/* Hook clips */}
      <section id="section-clips" className="rounded-xl border border-border bg-panel p-5 shadow-soft space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Hook clips</h2>
        <Clips clips={result.clips} />
      </section>

      {/* Lyrics card (mobile only — desktop shows the sticky column) */}
      {hasLyrics && (
        <div className="desktop:hidden">
          <LyricsPanel result={result} />
        </div>
      )}

      {/* Blurb & Collaborators */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-panel p-5 shadow-soft space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Pitch blurb</h2>
          <Blurb blurb={result.blurb} />
        </section>

        <section id="section-collaborators" className="rounded-xl border border-border bg-panel p-5 shadow-soft space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted" title="Based on overlap in what fans consume. A correlation, not genre or chart data.">
            Collaborators · Qloo affinity
          </h2>
          <Collaborators collabs={result.collaborators} />
        </section>
      </div>

      {/* Trace */}
      <section id="section-trace" className="rounded-xl border border-border bg-panel p-5 shadow-soft space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Agent trace</h2>
        <Trace events={events} />
      </section>
        </div>

        {hasLyrics && (
          <div className="sticky top-[72px] hidden self-start desktop:block" style={{ height: "calc(100dvh - 72px - 96px)" }}>
            <LyricsPanel result={result} sticky />
          </div>
        )}
      </div>

      <ChatDock result={result} askRequest={askRequest} onAskHandled={() => setAskRequest(null)} />
      </div>
    </AskContext.Provider>
  );
}

function limitingComponent(result) {
  const b = result.breakdown || {};
  const parts = [
    { key: "catalog", label: "Catalog match", value: b.catalog_match },
    { key: "audience", label: "Audience match", value: b.audience_match },
    { key: "hook", label: "Clip strength", value: result.clip_strength },
  ].filter((p) => p.value != null);
  if (!parts.length) return null;
  return [...parts].sort((a, b) => a.value - b.value)[0];
}

function VerdictBanner({ result, ranked, onEdit }) {
  const best = ranked.find((m) => m.status !== "no_data" && m.score != null);
  const fit = result.fit_score;
  const band = fit == null ? null : fit < 40 ? "low" : fit < 70 ? "moderate" : "strong";
  const clip = result.clips?.[0];
  const limiting = limitingComponent(result);

  const fixCopy = {
    catalog: "Add sounds-like artists to improve it.",
    audience: "Refine the audience signal to improve it.",
    hook: "Pick a stronger hook window to improve it.",
  };

  function handleFix() {
    onEdit?.({
      artist: result.artist,
      song_id: result.song,
      song_name: result.song_name,
      countries: (result.markets || []).map((m) => m.country),
      focus: limiting?.key === "catalog" ? "sounds_like" : null,
    });
  }

  return (
    <div className="mb-5 rounded-xl border border-border bg-panel p-4 text-body text-secondary">
      <div className="flex flex-wrap gap-x-2 gap-y-1">
        {best && <span>Best market: <span className="font-medium text-text">{best.country}</span> <span className="num text-text">({best.score})</span>.</span>}
        {fit != null && <span>Fit <span className="num text-text">{fit}/100</span>, {band}.</span>}
        {clip && <span>Post the <span className="num text-text">{formatTime(clip.start)} to {formatTime(clip.end)}</span> hook first.</span>}
      </div>
      {limiting && (
        <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-border pt-2 text-small text-muted">
          <span>{limiting.label} is the limiting factor. {fixCopy[limiting.key] || "Adjust the inputs to improve it."}</span>
          <button onClick={handleFix} className="rounded border border-border px-2 py-0.5 text-small text-accent hover:border-accent">Fix it</button>
        </div>
      )}
    </div>
  );
}

function BaselineModal({ result, baseline, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-border bg-panel p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border pb-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-text">Landfall vs a plain LLM</h2>
          <button onClick={onClose} className="text-muted hover:text-text">✕</button>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-md border border-border bg-raised p-4">
            <h3 className="text-small font-semibold text-text">Landfall (agent + Qloo)</h3>
            <p className="num text-2xl text-text">{result.fit_score ?? "—"}<span className="ml-1 text-small text-muted">/100</span></p>
            <p className="mt-2 text-small text-muted">
              Markets: {(result.markets || []).filter((m) => m.score != null).slice(0, 3).map((m) => `${m.country} ${m.score}`).join(", ") || "—"}
            </p>
            <p className="mt-2 text-small text-muted">
              Collaborators: {(result.collaborators || []).slice(0, 4).map((c) => c.name).join(", ") || "—"}
            </p>
          </div>
          <div className="rounded-md border border-border bg-raised p-4">
            <h3 className="text-small font-semibold text-text">Plain LLM (no agent)</h3>
            {baseline == null ? (
              <p className="mt-2 text-small text-muted">Generating…</p>
            ) : (
              <>
                <p className="num text-2xl text-text">{baseline.fit_score ?? "—"}<span className="ml-1 text-small text-muted">/100</span></p>
                <p className="mt-2 text-small text-muted">
                  Markets: {(baseline.markets || []).slice(0, 3).map((m) => `${m.country} ${m.score}`).join(", ") || "—"}
                </p>
                <p className="mt-2 text-small text-muted">
                  Collaborators: {(baseline.collaborators || []).slice(0, 4).map((c) => c.name).join(", ") || "—"}
                </p>
                {baseline.caveat && <p className="mt-2 text-[11px] italic text-muted">{baseline.caveat}</p>}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function LyricsToQloo({ lyrics }) {
  const themes = lyrics?.themes || [];
  const tags = lyrics?.tags || [];
  const entities = lyrics?.entities || [];
  if (!themes.length && !tags.length && !entities.length) return null;

  const byTerm = new Map(tags.map((t) => [(t.term || "").toLowerCase(), t]));
  const byMentioned = new Map(entities.map((e) => [(e.mentioned_as || e.name || "").toLowerCase(), e]));

  return (
    <section id="section-lyrics-qloo" className="rounded-xl border border-border bg-panel p-5 shadow-soft space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Lyrics → Qloo</h2>
        <AskButton context={{ type: "sound", label: "lyrics to qloo" }} question="How were the lyrics resolved against Qloo?" />
      </div>
      <p className="text-[11px] text-muted">
        Lyrical themes and named entities, resolved against Qloo's taste graph.
      </p>
      <div className="divide-y divide-border/60">
        {themes.map((theme, i) => {
          const tag = byTerm.get((theme || "").toLowerCase());
          return (
            <div key={`t${i}`} className="flex items-center justify-between py-1.5 text-xs">
              <span className="text-text">{theme}</span>
              {tag ? (
                <span className="rounded-full border border-positive/40 px-2 py-0.5 text-positive" title={tag.id}>✓ {tag.name}</span>
              ) : (
                <span className="text-muted">no Qloo match</span>
              )}
            </div>
          );
        })}
        {entities.map((e, i) => (
          <div key={`e${i}`} className="flex items-center justify-between py-1.5 text-xs">
            <span className="text-text">
              {e.mentioned_as && e.mentioned_as !== e.name ? <>{e.mentioned_as} <span className="text-muted/60">· {e.type}</span></> : e.name}
            </span>
            <span className="rounded-full border border-positive/40 px-2 py-0.5 text-positive">{e.name}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function SectionNav() {
  const items = [
    ["fit", "Fit"],
    ["markets", "Markets"],
    ["sound", "Sound"],
    ["audience", "Audience"],
    ["clips", "Clips"],
    ["trace", "Trace"],
  ];
  return (
    <nav className="mb-4 flex flex-wrap gap-2" aria-label="Report sections">
      {items.map(([id, label]) => (
        <a
          key={id}
          href={`#section-${id}`}
          onClick={(e) => {
            e.preventDefault();
            document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: "smooth" });
          }}
          className="rounded-pill border border-border px-3 py-1 text-small text-muted hover:border-accent hover:text-text"
        >
          {label}
        </a>
      ))}
    </nav>
  );
}

function Toggle({ label, checked, disabled, note, onChange }) {
  return (
    <label className={`flex items-center gap-1.5 ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="text-accent rounded focus:ring-2 focus:ring-accent"
      />
      <span>{label}</span>
      {note && <span className="text-[10px] text-muted">({note})</span>}
    </label>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-[11px] text-muted pt-2 border-t border-border">
      <span className="flex items-center gap-1.5">
        score scale
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: COLORS.low }} />
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: COLORS.high }} />
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: COLORS.top }} />
        (top 3)
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-full border border-[#5A616D]" />
        no Qloo data
      </span>
      <span>Predicted taste affinity, not chart position.</span>
    </div>
  );
}

function MarketDetail({ market, collaborators, isPending, onClose }) {
  const noData = market.status === "no_data" || market.score == null;
  return (
    <div className="mt-3 rounded-md border border-border bg-raised p-4 text-xs space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">
          {market.country}
          {market.country && <span className="ml-1 text-muted text-xs">({market.country})</span>}
          {isPending && noData
            ? <span className="num ml-2 text-muted animate-pulse">fetching…</span>
            : <span className="num ml-2 text-accent font-semibold">{noData ? "—" : market.score}</span>
          }
        </h3>
        <div className="flex items-center gap-2">
          <button onClick={onClose} className="text-muted hover:text-text">close</button>
          <AskButton context={{ type: "market", id: market.country, label: market.country }} question={`Why is ${market.country} ranked where it is?`} />
        </div>
      </div>

      <p className="text-muted leading-relaxed">{market.reason}</p>

      {!noData && (market.points != null || market.affinity_rank != null || market.affinity != null || market.popularity != null) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border/60 pt-2 text-[11px] text-muted">
          {market.points != null && <span className="num">{market.points} sampled locations</span>}
          {market.affinity_rank != null && <span className="num">affinity rank {market.affinity_rank.toFixed(2)}</span>}
          {market.affinity != null && <span className="num">affinity {market.affinity.toFixed(2)}</span>}
          {market.popularity != null && <span className="num">popularity {market.popularity.toFixed(2)}</span>}
        </div>
      )}

      {market.venues?.length > 0 && (
        <div className="pt-2">
          <span className="text-[10px] uppercase tracking-wider text-muted block mb-1">Live venues</span>
          <div className="flex flex-wrap gap-1.5">
            {market.venues.map((v, i) => (
              <span key={i} className="rounded border border-border bg-panel px-2 py-0.5 text-text">
                {v.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {collaborators?.length > 0 && (
        <div className="pt-2">
          <span className="text-[10px] uppercase tracking-wider text-muted block mb-1">Collaborators</span>
          <div className="flex flex-wrap gap-1.5">
            {collaborators.slice(0, 4).map((c, i) => (
              <span key={i} className="rounded border border-border bg-panel px-2 py-0.5 text-text">
                {c.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FitGauge({ score }) {
  const r = 78;
  const c = 2 * Math.PI * r;
  const target = score == null ? 0 : Math.min(100, Math.max(0, score));
  const count = useCountUp(target, 900);
  const reduced = useReducedMotion();
  const [drawn, setDrawn] = useState(reduced ? target : 0);
  useEffect(() => {
    const t = setTimeout(() => setDrawn(target), 50);
    return () => clearTimeout(t);
  }, [target]);

  const dash = c * (drawn / 100);
  const color = target >= 70 ? "var(--positive)" : target >= 40 ? "var(--accent)" : "var(--warn)";

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 180 180" className="h-[180px] w-[180px] shrink-0">
        <circle cx="90" cy="90" r={r} fill="none" stroke="#252930" strokeWidth="14" />
        <circle
          cx="90" cy="90" r={r} fill="none" stroke={color} strokeWidth="14"
          strokeDasharray={`${c} ${c}`} strokeDashoffset={c - dash}
          strokeLinecap="round" transform="rotate(-90 90 90)"
          style={{ transition: reduced ? "none" : "stroke-dashoffset 900ms var(--ease-out)" }}
        />
        <text x="90" y="100" textAnchor="middle" dominantBaseline="middle" className="num" fill="#E8EAED" fontSize="56" fontWeight="600">
          {score == null ? "—" : count}
        </text>
      </svg>
      <span className="mt-2 text-label text-muted">Predicted fit</span>
    </div>
  );
}

function FitRow({ label, caption, value }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="flex items-center gap-2">
          <span className="num text-text">{value == null ? "—" : Math.round(value)}</span>
          <AskButton context={{ type: "breakdown", id: label, label }} question={`What does the ${label.toLowerCase()} component mean?`} />
        </span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-raised">
        <div
          className="h-1.5 rounded-full bg-accent"
          style={{ width: `${value == null ? 0 : Math.min(100, value)}%` }}
        />
      </div>
      {caption && <p className="mt-0.5 text-[11px] text-muted">{caption}</p>}
    </div>
  );
}

function AudienceProfile({ profile }) {
  const tags = useMemo(() => dedupeTags(profile?.tags || []), [profile?.tags]);
  const entities = profile?.entities || [];
  const demo = profile?.demographics;
  const ask = useContext(AskContext);
  const [showAll, setShowAll] = useState(false);

  const visible = showAll ? tags : tags.slice(0, 8);

  return (
    <div className="space-y-4 text-xs">
      {/* Taste tags */}
      <div>
        <p className="mb-2 text-muted" title="Based on overlap in what fans consume. A correlation, not genre or chart data.">
          Qloo affinity <span className="cursor-help">ⓘ</span>
        </p>
        {tags.length === 0 ? (
          <p className="text-muted">No tags resolved from Qloo.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {visible.map((t, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => ask({ type: "audience", id: t.name, label: t.name }, `What does the ${t.name} affinity mean?`)}
                  title={`Ask about ${t.name}`}
                  className="rounded-full border border-border px-2.5 py-0.5 text-muted hover:border-accent hover:text-text transition-colors"
                >
                  {t.name}
                </button>
              ))}
            </div>
            {tags.length > 8 && (
              <button onClick={() => setShowAll((s) => !s)} className="mt-2 text-small text-accent hover:underline">
                {showAll ? "Show less" : `Show all (${tags.length})`}
              </button>
            )}
          </>
        )}
      </div>

      {/* Related entities */}
      {entities.length > 0 && (
        <div>
          <p className="mb-2 text-muted" title="Based on overlap in what fans consume. A correlation, not genre or chart data.">
            Related artists <span className="cursor-help">ⓘ</span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {entities.slice(0, 10).map((e, i) => (
              <span key={i} className="rounded-full border border-border px-2.5 py-0.5 text-muted">
                {e.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Demographics: diverging chart */}
      {demo && <DemographicsChart demo={demo} />}
    </div>
  );
}

function dedupeTags(tags) {
  const seen = new Set();
  const out = [];
  for (const t of tags) {
    const k = (t.name || "").toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

function DemographicsChart({ demo }) {
  const gender = demo.gender ? Object.entries(demo.gender) : [];
  const age = demo.age ? Object.entries(demo.age) : [];
  return (
    <div>
      <p className="mb-2 text-muted">Affinity index (relative, not a share)</p>
      {gender.length > 0 && (
        <div className="mb-3">
          <span className="text-[10px] uppercase tracking-wider text-muted">Gender</span>
          <div className="mt-1.5 space-y-1.5">
            {gender.map(([k, v]) => <DivergingBar key={k} label={k} value={v} />)}
          </div>
        </div>
      )}
      {age.length > 0 && (
        <div>
          <span className="text-[10px] uppercase tracking-wider text-muted">Age</span>
          <div className="mt-1.5 space-y-1.5">
            {age.map(([k, v]) => <DivergingBar key={k} label={k.replace(/_/g, " ")} value={v} />)}
          </div>
        </div>
      )}
      <p className="mt-2 text-[10px] leading-relaxed text-muted">
        Affinity vs the average audience: positive over-indexes, negative under-indexes.
      </p>
    </div>
  );
}

function DivergingBar({ label, value }) {
  const v = Number(value) || 0;
  const pct = Math.min(50, (Math.abs(v) / 1) * 50);
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 truncate text-muted capitalize">{label}</span>
      <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-raised">
        <div className="absolute left-1/2 top-0 h-full w-px bg-border" />
        <div
          className={`absolute top-0 h-full ${v >= 0 ? "bg-positive" : "bg-warn"}`}
          style={{ [v >= 0 ? "left" : "right"]: "50%", width: `${pct}%` }}
        />
      </div>
      <span className={`num w-12 shrink-0 text-right ${v >= 0 ? "text-positive" : "text-warn"}`}>{fmtAffinity(value)}</span>
    </div>
  );
}

function fmtAffinity(v) {
  if (v == null) return "—";
  const n = Number(v);
  const r = Math.round(n * 100) / 100;
  return `${r > 0 ? "+" : ""}${r.toFixed(2)}`;
}

function ArtistCard({ artist, catalog }) {
  const ytSongs = (catalog.top_songs || []).filter((s) => s.title).slice(0, 5);
  const spSongs = (catalog.spotify_top_songs || []).filter((s) => s.title).slice(0, 5).map((s) => ({ title: s.title }));
  return (
    <section className="rounded-xl border border-border bg-panel p-5 shadow-soft">
      <div className="flex items-center gap-4">
        {catalog.image && (
          <img
            src={catalog.image}
            alt={`${artist} artist image`}
            className="h-14 w-14 shrink-0 rounded-full border border-border object-cover"
          />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-text">{artist}</span>
          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted">
            Spotify · YouTube
          </span>
          {catalog.popularity != null && (
            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted num">
              Spotify popularity <span className="text-text font-semibold">{catalog.popularity}</span>/100
            </span>
          )}
          {catalog.genres?.length > 0 && (
            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted">
              {catalog.genres.slice(0, 2).join(" · ")}
            </span>
          )}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SongColumn label="Top songs · YouTube Music" songs={ytSongs} showViews />
        <SongColumn label="Top songs · Spotify" songs={spSongs} />
      </div>
    </section>
  );
}

function SongColumn({ label, songs, showViews = false }) {
  return (
    <div>
      <span className="text-[10px] uppercase tracking-wider text-muted">{label}</span>
      {songs.length > 0 ? (
        <ol className="mt-1 list-inside list-decimal text-xs space-y-0.5">
          {songs.map((s, i) => (
            <li key={i} className="flex items-baseline justify-between gap-2">
              <span className="truncate text-text">{s.title || s}</span>
              {showViews && s.views && (
                <span className="num shrink-0 text-[10px] text-muted">{s.views}</span>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-1 text-xs text-muted">Not available</p>
      )}
    </div>
  );
}

function Discography({ catalog }) {
  const albums = catalog.albums || [];
  const full = albums.filter((a) => a.type === "album");
  const singles = albums.filter((a) => a.type === "single");
  return (
    <details className="rounded-xl border border-border bg-panel p-5 shadow-soft">
      <summary className="flex cursor-pointer list-none items-center gap-3">
        {catalog.image && (
          <img src={catalog.image} alt="" className="h-10 w-10 rounded-full object-cover border border-border" />
        )}
        <div className="flex-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">Discography</span>
          <span className="ml-2 text-[10px] text-muted">Spotify · {albums.length} releases</span>
        </div>
        <span className="text-muted">▾</span>
      </summary>
      <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
        {albums.slice(0, 24).map((a, i) => (
          <div key={i} title={a.name} className="flex items-center justify-between rounded-md bg-raised px-3 py-2 text-xs">
            <span className="truncate text-text">{a.name}</span>
            <span className="num ml-2 shrink-0 text-muted">
              {a.release_date ? a.release_date.slice(0, 4) : "—"}
              {a.total_tracks != null && <span className="ml-1 text-[10px]">· {a.total_tracks} tracks</span>}
            </span>
          </div>
        ))}
      </div>
      {full.length === 0 && singles.length > 0 && (
        <p className="mt-2 text-[11px] text-muted">Singles only available via Spotify here.</p>
      )}
    </details>
  );
}

function Clips({ clips = [] }) {
  if (!clips.length) {
    return <p className="text-sm text-muted">No clips — upload a song to get hook clips.</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {clips.map((c, i) => (
        <ClipCard key={c.id || i} clip={c} index={i} />
      ))}
    </div>
  );
}

function ClipCard({ clip, index }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(clip.end - clip.start || 20);
  const audioRef = useRef(null);

  function togglePlay() {
    const a = audioRef.current;
    if (!a) return;
    if (isPlaying) {
      a.pause();
    } else {
      a.play().catch(() => {});
    }
  }

  function handleSeek(ratio) {
    const a = audioRef.current;
    if (!a || !duration) return;
    const target = ratio * duration;
    a.currentTime = target;
    setCurrentTime(target);
  }

  return (
    <div className="rounded-md border border-border bg-raised p-3 text-xs space-y-2">
      <audio
        ref={audioRef}
        src={clip.audio_url}
        onTimeUpdate={() => {
          if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
        }}
        onLoadedMetadata={() => {
          if (audioRef.current?.duration) setDuration(audioRef.current.duration);
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
      />

      <div className="flex items-center justify-between text-muted">
        <span className="flex items-center gap-1.5">
          <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">Hook</span>
          <span className="num">{formatTime(clip.start)}–{formatTime(clip.end)}</span>
        </span>
        <span className="flex items-center gap-2">
          <AskButton context={{ type: "clip", id: clip.id || index, label: `clip ${index + 1}` }} question="Which clip should I post first?" />
          {clip.audio_url && (
            <a href={clip.audio_url} download className="text-accent hover:underline">
              download
            </a>
          )}
        </span>
      </div>

      <Waveform
        peaks={clip.peaks}
        currentTime={currentTime}
        duration={duration}
        onSeek={handleSeek}
      />

      <div className="flex items-center justify-between pt-1">
        <button
          onClick={togglePlay}
          className="rounded border border-border px-2 py-0.5 text-text hover:border-accent"
        >
          {isPlaying ? "Pause" : "Play"}
        </button>
        <span className="num text-muted">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>

      {clip.caption && (
        <p className="pt-1 text-text leading-relaxed border-t border-border/60">
          {clip.caption}
        </p>
      )}
    </div>
  );
}

function Waveform({ peaks = [], currentTime = 0, duration = 1, onSeek }) {
  const ref = useRef(null);

  React.useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !peaks?.length) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const playRatio = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;
    const bar = w / peaks.length;

    peaks.forEach((p, i) => {
      const hh = Math.max(1, p * h);
      const isPlayed = i / peaks.length <= playRatio;
      ctx.fillStyle = isPlayed ? "#4A8FE7" : "#636A78";
      ctx.fillRect(i * bar, (h - hh) / 2, Math.max(1, bar - 1), hh);
    });
  }, [peaks, currentTime, duration]);

  function handleClick(e) {
    const canvas = ref.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek?.(ratio);
  }

  return (
    <canvas
      ref={ref}
      width={280}
      height={40}
      onClick={handleClick}
      className="w-full cursor-pointer"
    />
  );
}

function Blurb({ blurb }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(blurb || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  return (
    <div className="space-y-3">
      <p className="text-sm leading-relaxed text-text">{blurb || "No blurb available."}</p>
      <button
        onClick={copy}
        className="rounded-md border border-border px-3 py-1 text-xs text-muted hover:text-text"
      >
        {copied ? "Copied" : "Copy blurb"}
      </button>
    </div>
  );
}

function Collaborators({ collabs = [] }) {
  if (!collabs.length) {
    return <p className="text-sm text-muted">No collaborators suggested.</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {collabs.map((c, i) => (
        <div key={i} className="rounded-md bg-raised px-3 py-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="truncate text-sm font-medium text-text">{c.name}</span>
            <AskButton context={{ type: "collaborator", id: c.name, label: c.name }} question={`Why is ${c.name} a suggested collaborator?`} />
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel">
              <div className="h-full rounded-full bg-accent" style={{ width: `${c.affinity == null ? 0 : Math.min(100, c.affinity)}%` }} />
            </div>
            <span className="num shrink-0 text-muted">{c.affinity == null ? "—" : c.affinity}</span>
          </div>
          <p className="mt-1 text-muted leading-relaxed">{c.why}</p>
        </div>
      ))}
    </div>
  );
}

function Trace({ events = [] }) {
  return (
    <details className="group">
      <summary className="cursor-pointer text-xs text-muted hover:text-text">
        Show full trace ({events.length} steps)
      </summary>
      <div className="mt-3 space-y-1">
        {events.map((e, i) => (
          <div key={i} className="flex gap-3 border-b border-border py-1.5 text-xs">
            <span className="num w-6 text-muted">{i + 1}</span>
            <span className="w-20 text-muted uppercase text-[10px] mt-0.5">{e.stage}</span>
            <span className="w-32 font-mono text-accent truncate">{e.tool}</span>
            <span className="flex-1 text-muted truncate">{e.args_summary || e.result_summary}</span>
            <span className="num text-muted text-right">{e.status}</span>
          </div>
        ))}
      </div>
    </details>
  );
}
