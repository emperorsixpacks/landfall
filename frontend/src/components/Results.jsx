import React, { useEffect, useMemo, useRef, useState } from "react";
import GlobeContainer from "./GlobeContainer.jsx";
import MarketList from "./MarketList.jsx";
import SoundToTaste from "./SoundToTaste.jsx";
import { useCountUp, useReducedMotion } from "../hooks/useMotion";
import {
  COLORS,
  formatKey,
  formatTime,
  generateReleaseStrategyMarkdown,
  hasVenueCoordinates,
  joinMarketsToCities,
  rankMarkets,
  scoreToColor,
} from "../lib/globeUtils";

export default function Results({ result, events = [], cities = [], error, onReset }) {
  const [selectedCity, setSelectedCity] = useState(null);
  const [hoveredCity, setHoveredCity] = useState(null);
  const [toggles, setToggles] = useState({ markets: true, arcs: true, venues: true });
  const [copiedReport, setCopiedReport] = useState(false);
  const [pendingCities, setPendingCities] = useState(new Set());
  const [extraScores, setExtraScores] = useState({});
  const globeRef = useRef(null);

  const joinedMarkets = useMemo(
    () => joinMarketsToCities(result?.markets || [], cities),
    [result?.markets, cities]
  );
  const enrichedMarkets = useMemo(() => {
    if (!Object.keys(extraScores).length) return joinedMarkets;
    return joinedMarkets.map((m) =>
      extraScores[m.city] ? { ...m, ...extraScores[m.city] } : m
    );
  }, [joinedMarkets, extraScores]);
  const ranked = useMemo(() => rankMarkets(enrichedMarkets), [enrichedMarkets]);
  const venuesAvailable = hasVenueCoordinates(enrichedMarkets);
  const selected = ranked.find((m) => m.city === selectedCity) || null;

  function handleSelect(city) {
    setSelectedCity((prev) => (prev === city ? null : city));
    // Fly to city — use ranked (scored) entry first, fall back to raw cities list for gray dots
    const m = ranked.find((x) => x.city === city) || cities.find((x) => x.city === city);
    if (m) globeRef.current?.flyToCity(m);

    // Lazy-fetch score for no-data or unknown cities
    const rankedEntry = ranked.find((x) => x.city === city);
    const alreadyScored = rankedEntry && rankedEntry.score != null;
    const alreadyFetched = extraScores[city] !== undefined;
    const isPending = pendingCities.has(city);
    if (!alreadyScored && !alreadyFetched && !isPending) {
      const artistId = result?.audience_profile?.entities?.[0]?.id;
      if (!artistId) return;
      setPendingCities((prev) => new Set([...prev, city]));
      fetch(`/api/city-score?artist_id=${encodeURIComponent(artistId)}&city=${encodeURIComponent(city)}`)
        .then((r) => r.json())
        .then((data) => {
          setExtraScores((prev) => ({ ...prev, [city]: data }));
        })
        .catch(() => {
          setExtraScores((prev) => ({ ...prev, [city]: { city, score: null, reason: "Fetch failed.", status: "no_data" } }));
        })
        .finally(() => {
          setPendingCities((prev) => { const s = new Set(prev); s.delete(city); return s; });
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-baseline justify-between gap-4 border-b border-border pb-5">
        <div>
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
            {result.song ? `Track: ${result.song}` : "Acoustic audio omitted (plan only)"}
          </p>
        </div>

        <div className="flex items-center gap-3">
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

      {coverageGap && (
        <div className="rounded-lg border border-warning-subtle bg-warning-subtle/30 p-4 text-sm text-text-secondary leading-relaxed">
          Data coverage note: Qloo returned limited signals for certain tags or cities.
          Missing components were renormalized out of the fit score and flagged below — nothing is fabricated.
        </div>
      )}

      {/* Artist card (Spotify image + YouTube top songs) */}
      {result.catalog && (result.catalog.image || (result.catalog.top_songs?.length > 0)) && (
        <ArtistCard artist={result.artist} catalog={result.catalog} />
      )}

      {/* Top row: Fit Score & Audio Features */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Fit Score */}
        <section className="rounded-xl border border-border bg-panel p-5 space-y-4 shadow-soft">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Predicted fit</h2>
          <div className="flex items-center gap-6">
            <FitGauge score={result.fit_score} />
            <div className="flex-1 space-y-3">
              {result.breakdown && (
                <>
                  <FitRow label="Catalog match" value={result.breakdown.catalog_match} />
                  <FitRow label="Audience match" value={result.breakdown.audience_match} />
                  <FitRow label="Clip strength" value={result.clip_strength} />
                </>
              )}
            </div>
          </div>
          {result.explanation && (
            <p className="mt-3 text-sm text-text-secondary leading-relaxed">{result.explanation}</p>
          )}
          {ranked[0] && ranked[0].score != null && (
            <p className="text-small text-text">
              Strongest in <span className="font-medium">{ranked[0].city}</span> — {ranked[0].reason}
            </p>
          )}
          {result.warnings?.length > 0 && (
            <ul className="text-xs text-muted space-y-1">
              {result.warnings.map((w, i) => (
                <li key={i}>– {w} unavailable</li>
              ))}
            </ul>
          )}
        </section>

        {/* Audio features */}
        <section className="rounded-xl border border-border bg-panel p-5 space-y-4 lg:col-span-2 shadow-soft">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Audio features</h2>
            <span className="num text-2xs text-muted/60">librosa · ffmpeg</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
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
      </div>

      {/* Sound-to-taste bridge */}
      <section className="rounded-xl border border-border bg-panel p-5 shadow-soft space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Sound to taste</h2>
        <SoundToTaste bridge={result.bridge} />
      </section>

      {/* Lyrics themes */}
      {result.lyrics && (result.lyrics.tags?.length > 0 || result.lyrics.themes?.length > 0 || result.lyrics.segments?.length > 0 || result.lyrics.entities?.length > 0) && (
        <LyricsPanel lyrics={result.lyrics} songId={result.song} />
      )}

      {/* Target markets & Globe */}
      <section className="rounded-xl border border-border bg-panel p-5 shadow-soft space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Target markets</h2>
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
              onClick={() => { globeRef.current?.resetView(); setSelectedCity(null); }}
              className="rounded border border-border px-2 py-0.5 hover:text-text"
            >
              Reset view
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="lg:col-span-3 rounded-md overflow-hidden" style={{ minHeight: 420 }}>
            <GlobeContainer
              ref={globeRef}
              markets={enrichedMarkets}
              origin={result.origin}
              selectedCity={selectedCity}
              hoveredCity={hoveredCity}
              onSelect={handleSelect}
              onHover={setHoveredCity}
              showMarkets={toggles.markets}
              showArcs={toggles.arcs}
              showVenues={toggles.venues}
              allCities={cities}
              height={420}
            />
          </div>

          <div className="max-h-[440px] overflow-hidden rounded-md border border-border lg:col-span-2">
            <MarketList
              markets={enrichedMarkets}
              selectedCity={selectedCity}
              hoveredCity={hoveredCity}
              onSelect={handleSelect}
              onHover={setHoveredCity}
            />
          </div>
        </div>

        <Legend />

        {selected && (
          <MarketDetail
            market={selected}
            collaborators={result.collaborators || []}
            isPending={pendingCities.has(selectedCity)}
            onClose={() => setSelectedCity(null)}
          />
        )}
      </section>

      {/* Audience profile & demographics */}
      <section className="rounded-xl border border-border bg-panel p-5 shadow-soft space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Audience profile</h2>
        <AudienceProfile profile={result.audience_profile} />
      </section>

      {/* Discography (Spotify) */}
      {result.catalog?.albums?.length > 0 && (
        <Discography catalog={result.catalog} />
      )}

      {/* Hook clips */}
      <section className="rounded-xl border border-border bg-panel p-5 shadow-soft space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Hook clips</h2>
        <Clips clips={result.clips} />
      </section>

      {/* Blurb & Collaborators */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-panel p-5 shadow-soft space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Pitch blurb</h2>
          <Blurb blurb={result.blurb} />
        </section>

        <section className="rounded-xl border border-border bg-panel p-5 shadow-soft space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted" title="Based on overlap in what fans consume. A correlation, not genre or chart data.">
            Collaborators · Qloo affinity
          </h2>
          <Collaborators collabs={result.collaborators} />
        </section>
      </div>

      {/* Trace */}
      <section className="rounded-xl border border-border bg-panel p-5 shadow-soft space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Agent trace</h2>
        <Trace events={events} />
      </section>
    </div>
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
          {market.city}
          {market.country && <span className="ml-1 text-muted text-xs">({market.country})</span>}
          {isPending && noData
            ? <span className="num ml-2 text-muted animate-pulse">fetching…</span>
            : <span className="num ml-2 text-accent font-semibold">{noData ? "—" : market.score}</span>
          }
        </h3>
        <button onClick={onClose} className="text-muted hover:text-text">close</button>
      </div>

      <p className="text-muted leading-relaxed">{market.reason}</p>

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
  const r = 50;
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
    <svg viewBox="0 0 120 120" className="h-28 w-28 shrink-0">
      <circle cx="60" cy="60" r={r} fill="none" stroke="#252930" strokeWidth="10" />
      <circle
        cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth="10"
        strokeDasharray={`${c} ${c}`} strokeDashoffset={c - dash}
        strokeLinecap="round" transform="rotate(-90 60 60)"
        style={{ transition: reduced ? "none" : "stroke-dashoffset 900ms var(--ease-out)" }}
      />
      <text x="60" y="56" textAnchor="middle" dominantBaseline="middle" className="num" fill="#E8EAED" fontSize="28" fontWeight="600">
        {score == null ? "—" : count}
      </text>
      <text x="60" y="76" textAnchor="middle" className="num" fill="#7A808C" fontSize="9">
        predicted fit
      </text>
    </svg>
  );
}

function FitRow({ label, value }) {
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="num text-text">{value == null ? "—" : Math.round(value)}</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-raised">
        <div
          className="h-1.5 rounded-full bg-accent"
          style={{ width: `${value == null ? 0 : Math.min(100, value)}%` }}
        />
      </div>
    </div>
  );
}

function AudienceProfile({ profile }) {
  const tags = profile?.tags || [];
  const entities = profile?.entities || [];
  const demo = profile?.demographics;

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
          <div className="flex flex-wrap gap-1.5">
            {tags.slice(0, 20).map((t, i) => (
              <span key={i} className="rounded-full border border-border px-2.5 py-0.5 text-muted">
                {t.name}
              </span>
            ))}
          </div>
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

      {/* Demographics */}
      {demo && (
        <div>
          <p className="mb-2 text-muted">Affinity index (relative, not a share)</p>
          <div className="grid grid-cols-2 gap-2">
            {demo.gender &&
              Object.entries(demo.gender).map(([k, v]) => (
                <div key={k} className="flex justify-between rounded bg-raised px-3 py-1.5">
                  <span className="capitalize text-muted">{k}</span>
                  <span className={`num ${v >= 0 ? "text-positive" : "text-muted"}`}>{fmtAffinity(v)}</span>
                </div>
              ))}
            {demo.age &&
              Object.entries(demo.age).map(([k, v]) => (
                <div key={k} className="flex justify-between rounded bg-raised px-3 py-1.5">
                  <span className="text-muted">{k.replace(/_/g, " ")}</span>
                  <span className={`num ${v >= 0 ? "text-positive" : "text-muted"}`}>{fmtAffinity(v)}</span>
                </div>
              ))}
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-muted">
            Affinity vs the average audience: positive over-indexes, negative under-indexes.
          </p>
        </div>
      )}
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
    <section className="rounded-xl border border-border bg-panel p-5 shadow-soft space-y-3">
      <div className="flex items-center gap-3">
        {catalog.image && (
          <img src={catalog.image} alt="" className="h-10 w-10 rounded-full object-cover border border-border" />
        )}
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Discography</h2>
          <span className="text-[10px] text-muted">Spotify</span>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {albums.slice(0, 9).map((a, i) => (
          <div key={i} className="flex items-center justify-between rounded-md bg-raised px-3 py-2 text-xs">
            <span className="truncate text-text">{a.name}</span>
            <span className="num ml-2 shrink-0 text-muted">
              {a.release_date ? a.release_date.slice(0, 4) : "—"}
              {a.total_tracks != null && <span className="ml-1 text-[10px]">· {a.total_tracks} tracks</span>}
            </span>
          </div>
        ))}
      </div>
      {full.length === 0 && singles.length > 0 && (
        <p className="text-[11px] text-muted">Singles only available via Spotify here.</p>
      )}
    </section>
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
        <span className="num">{clip.start}s–{clip.end}s</span>
        {clip.audio_url && (
          <a href={clip.audio_url} download className="text-accent hover:underline">
            download
          </a>
        )}
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
    <ul className="space-y-2">
      {collabs.map((c, i) => (
        <li key={i} className="rounded-md bg-raised px-3 py-2 text-xs">
          <span className="text-sm font-medium text-text">{c.name}</span>
          <p className="text-muted leading-relaxed mt-0.5">{c.why}</p>
        </li>
      ))}
    </ul>
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

function LyricsPanel({ lyrics, songId }) {
  const tags = lyrics.tags || [];
  const segments = lyrics.segments || [];
  const audioRef = useRef(null);

  function seek(t) {
    if (audioRef.current) {
      audioRef.current.currentTime = t;
      audioRef.current.play();
    }
  }

  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  return (
    <section className="rounded-xl border border-border bg-panel p-5 shadow-soft space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Lyrics</h2>
        {(lyrics.language || lyrics.mood) && (
          <span className="text-small text-muted">
            {lyrics.language}{lyrics.mood ? ` · ${lyrics.mood}` : ""}
          </span>
        )}
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {tags.map((t, i) => (
            <span key={i} className="rounded-pill border border-accent/40 px-2.5 py-1 text-small text-accent">{t.name}</span>
          ))}
        </div>
      )}

      {(lyrics.entities || []).length > 0 && (
        <div>
          <p className="mb-1.5 text-label text-muted">Named in lyrics · resolved in Qloo</p>
          <div className="flex flex-wrap gap-2">
            {lyrics.entities.map((e, i) => (
              <span key={i} className="rounded-pill border border-positive/40 px-2.5 py-1 text-small text-positive">
                {e.name} <span className="text-muted">· {e.type}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {songId && <audio ref={audioRef} controls src={`/api/audio/${songId}`} className="w-full" />}

      {segments.length > 0 ? (
        <div className="max-h-64 space-y-1 overflow-y-auto rounded-md bg-raised p-3">
          {segments.map((s, i) => (
            <button key={i} onClick={() => seek(s.start)} className="flex w-full items-baseline gap-3 text-left text-small hover:text-text">
              <span className="num shrink-0 text-muted">{fmt(s.start)}</span>
              <span className="text-secondary">{s.text}</span>
            </button>
          ))}
        </div>
      ) : (
        lyrics.transcript && <p className="text-small leading-relaxed text-secondary">{lyrics.transcript}</p>
      )}

      {segments.length > 0 && (
        <p className="text-[11px] text-muted">Transcript is estimated (Whisper). Click a line to play from there.</p>
      )}
    </section>
  );
}
