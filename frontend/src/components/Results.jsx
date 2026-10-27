import React, { useMemo, useRef, useState } from "react";
import GlobeContainer from "./GlobeContainer.jsx";
import MarketList from "./MarketList.jsx";
import { COLORS, hasVenueCoordinates, joinMarketsToCities, rankMarkets } from "../lib/globeUtils";

export default function Results({ result, events, cities = [], error, onReset }) {
  const [selectedCity, setSelectedCity] = useState(null);
  const [hoveredCity, setHoveredCity] = useState(null);
  const [toggles, setToggles] = useState({ markets: true, arcs: true, venues: true });
  const globeRef = useRef(null);

  const joinedMarkets = useMemo(
    () => joinMarketsToCities(result?.markets || [], cities),
    [result?.markets, cities]
  );
  const ranked = useMemo(() => rankMarkets(joinedMarkets), [joinedMarkets]);
  const venuesAvailable = hasVenueCoordinates(joinedMarkets);
  const selected = ranked.find((m) => m.city === selectedCity) || null;

  function handleSelect(city) {
    setSelectedCity((prev) => (prev === city ? null : city));
    const m = ranked.find((x) => x.city === city);
    if (m) globeRef.current?.flyToCity(m);
  }

  function saveImage() {
    const url = globeRef.current?.saveImage();
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = "landfall-globe.png";
    a.click();
  }

  if (!result) {
    return (
      <div className="space-y-4">
        <p className="text-red-400">{error || "No result returned."}</p>
        <button onClick={onReset} className="rounded-md border border-border px-4 py-2 text-sm">
          Back
        </button>
      </div>
    );
  }

  const coverageGap =
    (result.audience_profile?.tags?.length || 0) === 0 ||
    (result.markets || []).every((m) => m.score == null);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">
            {result.artist}
            {result.data_mode === "mock" && (
              <span className="ml-3 align-middle rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted">
                sample data
              </span>
            )}
          </h1>
          <p className="text-sm text-muted">{result.song || "no audio — plan only"}</p>
        </div>
        <button onClick={onReset} className="rounded-md border border-border px-4 py-2 text-sm text-muted hover:text-text">
          New run
        </button>
      </div>

      {coverageGap && (
        <div className="rounded-md border border-border bg-panel p-3 text-sm text-muted">
          Data coverage note: Qloo returned nothing for some signals. Missing pieces are
          renormalized out of the fit score and flagged below — nothing is invented.
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <FitPanel score={result.fit_score} breakdown={result.breakdown} explanation={result.explanation} warnings={result.warnings} />
        <div className="lg:col-span-2">
          <AudienceProfile profile={result.audience_profile} descriptors={result.descriptors} />
        </div>
      </div>

      <section className="rounded-lg border border-border bg-panel p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Candidate markets</h2>
          <div className="flex items-center gap-4 text-xs text-muted">
            <Toggle label="Markets" checked={toggles.markets} onChange={(v) => setToggles((t) => ({ ...t, markets: v }))} />
            <Toggle label="Arcs" checked={toggles.arcs} disabled={!result.origin} onChange={(v) => setToggles((t) => ({ ...t, arcs: v }))} />
            <Toggle
              label="Venues"
              checked={toggles.venues}
              disabled={!venuesAvailable}
              note={venuesAvailable ? null : "venue coordinates unavailable"}
              onChange={(v) => setToggles((t) => ({ ...t, venues: v }))}
            />
            <button onClick={saveImage} className="rounded-md border border-border px-2 py-1 hover:text-text">Save image</button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="lg:col-span-3" style={{ minHeight: 420 }}>
            <GlobeContainer
              ref={globeRef}
              markets={joinedMarkets}
              origin={result.origin}
              selectedCity={selectedCity}
              hoveredCity={hoveredCity}
              onSelect={handleSelect}
              onHover={setHoveredCity}
              showMarkets={toggles.markets}
              showArcs={toggles.arcs}
              showVenues={toggles.venues}
              height={420}
            />
          </div>
          <div className="max-h-[460px] overflow-auto rounded-md border border-border lg:col-span-2">
            <MarketList
              markets={joinedMarkets}
              selectedCity={selectedCity}
              hoveredCity={hoveredCity}
              onSelect={handleSelect}
              onHover={setHoveredCity}
            />
          </div>
        </div>

        <Legend />

        {selected && (
          <MarketDetail market={selected} collaborators={result.collaborators || []} onClose={() => setSelectedCity(null)} />
        )}
      </section>

      <Section title="Hook clips">
        <Clips clips={result.clips} />
      </Section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section title="Blurb">
          <Blurb blurb={result.blurb} />
        </Section>
        <Section title="Collaborators">
          <Collaborators collabs={result.collaborators} />
        </Section>
      </div>

      <Section title="How the agent decided">
        <Trace events={events} />
      </Section>
    </div>
  );
}

function Toggle({ label, checked, disabled, note, onChange }) {
  return (
    <label className={`flex items-center gap-2 ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="accent-[#5B9DFF]" />
      <span>{label}</span>
      {note && <span className="text-[10px] text-muted">({note})</span>}
    </label>
  );
}

function Legend() {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-muted">
      <span className="flex items-center gap-1.5">
        score scale
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: COLORS.low }} />
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: COLORS.high }} />
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: COLORS.top }} />
        (top 3)
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-3 rounded-full border border-[#5A616D]" />
        no Qloo data
      </span>
      <span>Predicted fit from Qloo taste affinity, not streams.</span>
    </div>
  );
}

function MarketDetail({ market, collaborators, onClose }) {
  const noData = market.status === "no_data" || market.score == null;
  return (
    <div className="mt-4 rounded-md border border-border bg-raised p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">
          {market.city} <span className="num ml-2 text-accent">{noData ? "—" : market.score}</span>
        </h3>
        <button onClick={onClose} className="text-xs text-muted hover:text-text">close</button>
      </div>
      <p className="mt-1 text-xs text-muted">{market.reason}</p>
      {market.venues?.length > 0 && (
        <div className="mt-3">
          <p className="text-xs text-muted">Venues</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {market.venues.map((v, i) => (
              <span key={i} className="rounded-full border border-border px-2 py-0.5 text-xs text-text">{v.name}</span>
            ))}
          </div>
        </div>
      )}
      {collaborators.length > 0 && (
        <div className="mt-3">
          <p className="text-xs text-muted">Collaborators</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {collaborators.slice(0, 5).map((c, i) => (
              <span key={i} className="rounded-full border border-border px-2 py-0.5 text-xs text-text">{c.name}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="rounded-lg border border-border bg-panel p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h2>
      {children}
    </section>
  );
}

function FitPanel({ score, breakdown, explanation, warnings }) {
  return (
    <Section title="Predicted fit">
      <div className="flex items-center gap-6">
        <FitGauge score={score} />
        <div className="flex-1 space-y-3">
          {breakdown &&
            Object.entries(breakdown).map(([k, v]) => (
              <div key={k}>
                <div className="flex justify-between text-xs">
                  <span className="capitalize text-muted">{k}</span>
                  <span className="num text-text">{v == null ? "—" : Math.round(v)}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-raised">
                  <div className="h-1.5 rounded-full bg-accent" style={{ width: `${v == null ? 0 : v}%` }} />
                </div>
              </div>
            ))}
        </div>
      </div>
      {explanation && <p className="mt-4 text-xs text-muted">{explanation}</p>}
      {warnings?.length > 0 && (
        <ul className="mt-2 text-xs text-muted">
          {warnings.map((w, i) => (
            <li key={i}>- {w} unavailable</li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function FitGauge({ score }) {
  const r = 56;
  const c = 2 * Math.PI * r;
  const pct = score == null ? 0 : Math.min(100, Math.max(0, score)) / 100;
  return (
    <svg viewBox="0 0 140 140" className="h-32 w-32 shrink-0">
      <circle cx="70" cy="70" r={r} fill="none" stroke="#262A33" strokeWidth="12" />
      <circle
        cx="70" cy="70" r={r} fill="none" stroke="#4CC38A" strokeWidth="12"
        strokeDasharray={`${c * pct} ${c}`} strokeLinecap="round"
        transform="rotate(-90 70 70)"
      />
      <text x="70" y="70" textAnchor="middle" dominantBaseline="middle"
        className="num" fill="#E8EAED" fontSize="30" fontWeight="600">
        {score == null ? "—" : score}
      </text>
    </svg>
  );
}

function AudienceProfile({ profile, descriptors }) {
  const tags = profile?.tags || [];
  const entities = profile?.entities || [];
  const demo = profile?.demographics;
  return (
    <div className="space-y-4">
      {descriptors?.length > 0 && (
        <div>
          <p className="mb-2 text-xs text-muted">Sound descriptors</p>
          <div className="flex flex-wrap gap-2">
            {descriptors.map((d) => (
              <span key={d} className="rounded-full border border-accent/40 px-3 py-1 text-xs text-text">{d}</span>
            ))}
          </div>
        </div>
      )}
      <div>
        <p className="mb-2 text-xs text-muted">Audience taste tags (affinity)</p>
        {tags.length === 0 ? (
          <p className="text-sm text-muted">No tags resolved from Qloo.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {tags.slice(0, 20).map((t, i) => (
              <span key={i} className="rounded-full border border-border px-3 py-1 text-xs text-muted">{t.name}</span>
            ))}
          </div>
        )}
      </div>
      {entities.length > 0 && (
        <div>
          <p className="mb-2 text-xs text-muted">Related entities</p>
          <div className="flex flex-wrap gap-2">
            {entities.slice(0, 10).map((e, i) => (
              <span key={i} className="rounded-full border border-border px-3 py-1 text-xs text-muted">{e.name}</span>
            ))}
          </div>
        </div>
      )}
      {demo && (
        <div>
          <p className="mb-2 text-xs text-muted">Demographic affinity</p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {demo.gender &&
              Object.entries(demo.gender).map(([k, v]) => (
                <div key={k} className="flex justify-between rounded-md bg-raised px-3 py-2">
                  <span className="capitalize text-muted">{k}</span>
                  <span className="num text-text">{v}</span>
                </div>
              ))}
            {demo.age &&
              Object.entries(demo.age).map(([k, v]) => (
                <div key={k} className="flex justify-between rounded-md bg-raised px-3 py-2">
                  <span className="text-muted">{k.replace(/_/g, " ")}</span>
                  <span className="num text-text">{v}</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Clips({ clips }) {
  if (!clips?.length) {
    return <p className="text-sm text-muted">No clips — upload a song to get hook clips.</p>;
  }
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {clips.map((c) => (
        <div key={c.id} className="rounded-md border border-border bg-raised p-3">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="num text-muted">{c.start}s–{c.end}s</span>
            <a href={c.audio_url} download className="text-accent hover:underline">download</a>
          </div>
          <Waveform peaks={c.peaks} />
          <audio controls src={c.audio_url} className="mt-2 w-full" />
          <p className="mt-2 text-xs text-text">{c.caption}</p>
        </div>
      ))}
    </div>
  );
}

function Waveform({ peaks }) {
  const ref = useRef(null);
  React.useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !peaks?.length) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const bar = w / peaks.length;
    peaks.forEach((p, i) => {
      const hh = Math.max(1, p * h);
      ctx.fillStyle = "#5B9DFF";
      ctx.fillRect(i * bar, (h - hh) / 2, Math.max(1, bar - 1), hh);
    });
  }, [peaks]);
  return <canvas ref={ref} width={280} height={48} className="w-full" />;
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
    <div>
      <p className="text-sm leading-relaxed text-text">{blurb}</p>
      <button onClick={copy} className="mt-3 rounded-md border border-border px-3 py-1 text-xs text-muted hover:text-text">
        {copied ? "Copied" : "Copy blurb"}
      </button>
    </div>
  );
}

function Collaborators({ collabs }) {
  if (!collabs?.length) {
    return <p className="text-sm text-muted">No collaborators suggested.</p>;
  }
  return (
    <ul className="space-y-2">
      {collabs.map((c, i) => (
        <li key={i} className="rounded-md bg-raised px-3 py-2">
          <span className="text-sm text-text">{c.name}</span>
          <p className="text-xs text-muted">{c.why}</p>
        </li>
      ))}
    </ul>
  );
}

function Trace({ events }) {
  return (
    <details className="group">
      <summary className="cursor-pointer text-sm text-muted hover:text-text">
        Show full trace ({events.length} steps)
      </summary>
      <div className="mt-3 space-y-1">
        {events.map((e, i) => (
          <div key={i} className="flex gap-3 border-b border-border py-1.5 text-xs">
            <span className="num w-8 text-muted">{i + 1}</span>
            <span className="w-20 text-muted">{e.stage}</span>
            <span className="w-32 font-mono text-accent">{e.tool}</span>
            <span className="flex-1 text-muted">{e.args_summary}</span>
            <span className="num text-muted">{e.status}</span>
          </div>
        ))}
      </div>
    </details>
  );
}
