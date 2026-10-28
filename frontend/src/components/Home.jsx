import React, { useEffect, useMemo, useRef, useState } from "react";
import { useInView, useReducedMotion } from "../hooks/useMotion";

const PRESETS = [
  { label: "Global", cities: ["Lagos", "London", "New York", "Paris", "Tokyo", "Johannesburg", "Los Angeles", "Accra", "Mumbai", "São Paulo", "Berlin", "Dubai"] },
  { label: "West Africa", cities: ["Lagos", "Abuja", "Accra", "Dakar", "Abidjan", "Port Harcourt", "Benin City"] },
  { label: "Europe", cities: ["London", "Paris", "Berlin", "Amsterdam", "Madrid", "Lisbon", "Stockholm"] },
  { label: "North America", cities: ["New York", "Los Angeles", "Atlanta", "Toronto", "Chicago", "Miami"] },
];

const HEADLINE = ["Where", "will", "your", "next", "song", "land?"];

export default function Home({ config, allCities = [], onRun, onError }) {
  const reduced = useReducedMotion();

  // Artist
  const [artistQuery, setArtistQuery] = useState("");
  const [debouncedArtistQuery, setDebouncedArtistQuery] = useState("");
  const [resolvedArtist, setResolvedArtist] = useState(null);
  const [showArtistDropdown, setShowArtistDropdown] = useState(false);
  const [artistMatches, setArtistMatches] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const artistInputRef = useRef(null);

  // Track
  const [songId, setSongId] = useState(null);
  const [songName, setSongName] = useState(null);
  const [duration, setDuration] = useState(null);
  const [isSampleTrack, setIsSampleTrack] = useState(false);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [genre, setGenre] = useState("");
  const [uploadBusy, setUploadBusy] = useState(false);
  const fileInputRef = useRef(null);

  // Markets
  const [cities, setCities] = useState(PRESETS[1].cities);
  const [activePreset, setActivePreset] = useState("West Africa");
  const [marketSearch, setMarketSearch] = useState("");

  useEffect(() => {
    const h = setTimeout(() => setDebouncedArtistQuery(artistQuery.trim()), 250);
    return () => clearTimeout(h);
  }, [artistQuery]);

  useEffect(() => {
    let cancelled = false;
    if (!debouncedArtistQuery) {
      setArtistMatches([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    fetch(`/api/artists/search?q=${encodeURIComponent(debouncedArtistQuery)}`)
      .then((r) => r.json())
      .then((list) => { if (!cancelled) setArtistMatches(list || []); })
      .catch(() => { if (!cancelled) setArtistMatches([]); })
      .finally(() => { if (!cancelled) setIsSearching(false); });
    return () => { cancelled = true; };
  }, [debouncedArtistQuery]);

  function selectArtist(name) {
    setResolvedArtist(name);
    setArtistQuery(name);
    setShowArtistDropdown(false);
  }

  function changeArtist() {
    setResolvedArtist(null);
    setArtistQuery("");
    setShowArtistDropdown(false);
    setTimeout(() => artistInputRef.current?.focus(), 50);
  }

  async function upload(file) {
    if (!file) return;
    setUploadBusy(true);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (!res.ok) {
        onError("Upload failed: " + (await res.text()));
        setUploadBusy(false);
        return;
      }
      const data = await res.json();
      setSongId(data.song_id);
      setSongName(data.name || file.name);
      setIsSampleTrack(false);
      setRightsConfirmed(false);
    } catch (err) {
      onError("Upload error: " + err.message);
    } finally {
      setUploadBusy(false);
    }
  }

  function useSample() {
    const s = config.sample_tracks?.[0];
    if (s) {
      setSongId(s.song_id);
      setSongName(s.name);
    } else {
      setSongId("sample_demo_track");
      setSongName("Sample Demo Track");
    }
    setDuration(184);
    setIsSampleTrack(true);
    setRightsConfirmed(true);
  }

  function removeSong() {
    setSongId(null);
    setSongName(null);
    setDuration(null);
    setIsSampleTrack(false);
    setRightsConfirmed(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function selectPreset(p) {
    setActivePreset(p.label);
    setCities(p.cities.slice(0, 12));
  }

  function toggleCity(city) {
    setActivePreset(null);
    setCities((prev) => {
      if (prev.includes(city)) return prev.filter((c) => c !== city);
      if (prev.length >= 12) return prev;
      return [...prev, city];
    });
  }

  const cityPool = useMemo(() => {
    if (allCities.length > 0) return allCities;
    return PRESETS[0].cities.map((c) => ({ city: c, country: "" }));
  }, [allCities]);

  const displayedCities = useMemo(() => {
    const set = new Set(cities);
    if (marketSearch.trim()) {
      const q = marketSearch.toLowerCase();
      return cityPool.filter((c) => c.city.toLowerCase().includes(q) || (c.country && c.country.toLowerCase().includes(q)));
    }
    return cityPool.filter((c) => set.has(c.city));
  }, [cityPool, cities, marketSearch]);

  const hasArtist = Boolean(resolvedArtist);
  const hasTrack = Boolean(songId);
  const hasRights = isSampleTrack || rightsConfirmed;
  const hasMarkets = cities.length > 0;
  const isReady = hasArtist && hasTrack && hasRights && hasMarkets;

  const missing = [];
  if (!hasArtist) missing.push("Artist");
  if (!hasTrack) missing.push("Track");
  if (!hasRights) missing.push("Rights confirmation");
  if (!hasMarkets) missing.push("Target markets");

  function start() {
    if (!isReady) return;
    onRun({ artist: resolvedArtist.trim(), song_id: songId, genre: genre.trim() || null, cities });
  }

  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && isReady) {
        e.preventDefault();
        start();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isReady, resolvedArtist, songId, genre, cities]);

  return (
    <div>
      <div className="grid grid-cols-1 gap-12 desktop:grid-cols-2">
        {/* Left: hero (sticky on desktop) */}
        <div className="self-start desktop:sticky desktop:top-20">
          <Hero reduced={reduced} />
          <div className="mt-5 flex flex-wrap gap-2">
            {["Qloo taste data", "Audio analysis", "Every step traced"].map((t) => (
              <span key={t} className="rounded-pill border border-border px-3 py-1 text-small text-muted">
                {t}
              </span>
            ))}
          </div>
        </div>

        {/* Right: form */}
        <div className="space-y-5">
          <FormSection index="1" title="Artist">
            {resolvedArtist ? (
              <div className="flex items-center justify-between rounded-control border border-border bg-raised px-4 py-3">
                <div className="flex items-center gap-2">
                  <Check size={16} reduced={reduced} />
                  <span className="text-body font-medium text-text">{resolvedArtist}</span>
                  <span className="text-small text-positive">Found in Qloo</span>
                </div>
                <button onClick={changeArtist} className="text-small text-muted hover:text-text">Change</button>
              </div>
            ) : (
              <div className="relative">
                <input
                  ref={artistInputRef}
                  value={artistQuery}
                  onChange={(e) => { setArtistQuery(e.target.value); setShowArtistDropdown(true); }}
                  onFocus={() => { if (artistQuery.trim()) setShowArtistDropdown(true); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && artistMatches.length > 0) { e.preventDefault(); selectArtist(artistMatches[0].name); }
                    else if (e.key === "Escape") setShowArtistDropdown(false);
                  }}
                  placeholder="Search an artist…"
                  className="h-12 w-full rounded-control border border-border bg-raised px-4 text-body text-text placeholder:text-muted outline-none focus:border-accent"
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  {(config.sample_artists || []).slice(0, 3).map((a) => (
                    <button key={a} onClick={() => selectArtist(a)} className="rounded-pill border border-border px-3 py-1 text-small text-muted hover:border-accent hover:text-text">
                      Try: {a}
                    </button>
                  ))}
                </div>
                {showArtistDropdown && debouncedArtistQuery && (
                  <div className="absolute left-0 right-0 top-[52px] z-30 max-h-56 overflow-y-auto rounded-control border border-border bg-panel divide-y divide-border" style={reduced ? undefined : { animation: "fade-up 160ms var(--ease-out)" }}>
                    {isSearching ? (
                      <div className="px-4 py-3 text-small text-muted">Searching…</div>
                    ) : artistMatches.length > 0 ? (
                      artistMatches.map((m) => (
                        <button key={m.name} type="button" onClick={() => selectArtist(m.name)} className="flex w-full items-center justify-between px-4 py-2.5 text-left text-body hover:bg-raised">
                          <span className="text-text">{m.name}</span>
                          <span className="text-small text-muted">{m.type}</span>
                        </button>
                      ))
                    ) : (
                      <div className="px-4 py-3 text-small text-muted">No match found. Try another spelling.</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </FormSection>

          <FormSection index="2" title="New song">
            {songName ? (
              <div className="flex items-center justify-between rounded-control border border-border bg-raised px-4 py-3">
                <div className="min-w-0">
                  <span className="block truncate text-body font-medium text-text">{songName}</span>
                  {duration != null && <span className="num text-muted">{Math.floor(duration / 60)}:{String(duration % 60).padStart(2, "0")}</span>}
                </div>
                <button onClick={removeSong} className="text-small text-muted hover:text-text">Remove</button>
              </div>
            ) : (
              <div>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files?.[0]); }}
                  className="flex h-24 cursor-pointer items-center justify-center rounded-control border border-dashed border-border bg-panel text-center text-small text-muted hover:border-accent"
                >
                  <div>
                    <p>{uploadBusy ? "Uploading…" : "Drop a track here or browse"}</p>
                    <p className="mt-0.5 text-muted">MP3 · WAV · M4A, 25 MB max</p>
                  </div>
                  <input ref={fileInputRef} type="file" accept=".mp3,.wav,.m4a" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
                </div>
                {config.sample_tracks?.length > 0 && (
                  <button onClick={useSample} className="mt-2 text-small text-accent hover:underline">Use a sample track</button>
                )}
              </div>
            )}
            <input
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              placeholder="Genre (optional)"
              className="mt-3 h-10 w-full rounded-control border border-border bg-raised px-3 text-body text-text placeholder:text-muted outline-none focus:border-accent"
            />
          </FormSection>

          <FormSection index="3" title={`Markets · ${cities.length} of 12`}>
            <input
              value={marketSearch}
              onChange={(e) => setMarketSearch(e.target.value)}
              placeholder="Search cities…"
              className="mb-3 h-10 w-full rounded-control border border-border bg-raised px-3 text-body text-text placeholder:text-muted outline-none focus:border-accent"
            />
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => selectPreset(p)}
                  className={`rounded-pill border px-3 py-1 text-small ${activePreset === p.label ? "border-accent bg-accent/10 text-accent" : "border-border text-muted hover:border-accent"}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {displayedCities.map((c) => {
                const on = cities.includes(c.city);
                return (
                  <button
                    key={c.city}
                    onClick={() => toggleCity(c.city)}
                    className={`rounded-pill border px-3 py-1 text-small ${on ? "border-accent bg-accent/10 text-text" : "border-border text-muted hover:border-accent"}`}
                  >
                    {on && <span className="mr-1 text-accent">✓</span>}{c.city}
                  </button>
                );
              })}
            </div>
          </FormSection>

          <div className="rounded-card border border-border bg-panel p-5">
            <label className="flex items-center gap-2 text-small text-text">
              <input type="checkbox" checked={hasRights} onChange={(e) => { if (!isSampleTrack) setRightsConfirmed(e.target.checked); }} className="accent-[#5B9DFF]" />
              I own this track or it is royalty free
            </label>

            <div className="mt-4 flex items-center justify-between">
              <div className="text-small text-muted">
                {isReady ? (
                  <span className="flex items-center gap-1.5"><Check size={14} reduced={reduced} /> Ready</span>
                ) : (
                  <span>Missing: {missing.join(", ") || "—"}</span>
                )}
              </div>
              <button
                onClick={start}
                disabled={!isReady}
                className={`rounded-control px-6 py-2.5 text-body font-semibold transition-colors ${isReady ? "bg-accent text-black hover:brightness-110" : "cursor-not-allowed bg-raised text-muted"}`}
              >
                Plan the release
              </button>
            </div>
          </div>
        </div>
      </div>

      <HowItWorks reduced={reduced} />
      <WhyQloo />
    </div>
  );
}

function Hero({ reduced }) {
  return (
    <div className="space-y-6">
      <p className="text-label text-muted">Agentic release planner</p>
      <h1 className="text-display text-text">
        {HEADLINE.map((word, i) => {
          const isLand = word.toLowerCase().startsWith("land");
          return (
            <span key={i} className="inline-block" style={reduced ? undefined : { animation: `fade-up 420ms var(--ease-out) ${i * 70}ms both` }}>
              {isLand ? (
                <span className="relative inline-block">
                  {word}
                  <svg className="absolute -bottom-1 left-0 w-full" height="6" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true">
                    <path d="M2 4 Q 50 -2 98 4" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round"
                      style={reduced ? undefined : { strokeDasharray: 120, strokeDashoffset: 120, animation: `draw-stroke 400ms var(--ease-out) ${HEADLINE.length * 70}ms forwards` }} />
                  </svg>
                </span>
              ) : (
                word
              )}
              {i < HEADLINE.length - 1 ? " " : ""}
            </span>
          );
        })}
      </h1>
      <p className="max-w-md text-body text-secondary">
        Pick an artist, drop an unreleased track. An agent uses Qloo taste data to predict fit, markets, and clips.
      </p>

      <ArcStoryboard reduced={reduced} />
      <WaveformBars reduced={reduced} />
    </div>
  );
}

function ArcStoryboard({ reduced }) {
  const dur = reduced ? 0 : 1;
  return (
    <svg viewBox="0 0 220 120" className="h-28 w-52" aria-hidden="true">
      <path
        d="M10 105 Q 110 10 210 105"
        fill="none" stroke="var(--border)" strokeWidth="3" strokeLinecap="round"
        style={reduced ? undefined : { strokeDasharray: 400, strokeDashoffset: 400, animation: `draw-stroke 700ms var(--ease-out) ${dur}ms forwards` }}
      />
      <path
        d="M10 105 Q 110 10 210 105"
        fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round"
        style={reduced ? undefined : { strokeDasharray: 400, strokeDashoffset: 400, animation: `draw-stroke 700ms var(--ease-out) 0ms forwards` }}
      />
      <circle cx="110" cy="34" r="4" fill="var(--positive)"
        style={reduced ? undefined : { animation: "scale-pop 240ms var(--ease-out) 700ms both" }} />
      {[0, 1, 2].map((i) => (
        <circle key={i} cx="110" cy="34" r="4" fill="none" stroke="var(--positive)" strokeWidth="1"
          style={reduced ? undefined : { transformBox: "fill-box", transformOrigin: "center", animation: `ripple 1400ms ease-out ${950 + i * 120}ms infinite` }} />
      ))}
    </svg>
  );
}

function WaveformBars({ reduced }) {
  const heights = [0.3, 0.6, 0.45, 0.9, 0.5, 0.75, 0.4, 0.85, 0.55, 0.7, 0.35, 0.8, 0.5, 0.65, 0.4, 0.6, 0.5, 0.7, 0.3, 0.8, 0.45, 0.6, 0.5, 0.75, 0.35, 0.65, 0.5, 0.7, 0.4, 0.85, 0.5, 0.6, 0.45, 0.7, 0.3, 0.75, 0.5, 0.65, 0.4, 0.8, 0.55, 0.6, 0.45, 0.7, 0.35, 0.75, 0.5, 0.6];
  return (
    <div className="flex h-8 items-end gap-0.5 opacity-20" aria-hidden="true">
      {heights.map((h, i) => (
        <span key={i} className="w-1 rounded-sm bg-accent" style={{ height: `${h * 100}%`, animation: reduced ? undefined : `waveform 2.4s ease-in-out ${i * 0.05}s infinite` }} />
      ))}
    </div>
  );
}

function HowItWorks({ reduced }) {
  const [ref, inView] = useInView(true);
  const steps = [
    { n: "1", title: "Listen", body: "The agent reads your track — tempo, key, energy." },
    { n: "2", title: "Translate", body: "Sound becomes plain descriptors and taste tags." },
    { n: "3", title: "Ask Qloo", body: "Taste data resolves artists, places, and audiences." },
    { n: "4", title: "Plan", body: "Fit, markets, clips, and a release strategy." },
  ];
  return (
    <section ref={ref} className="mt-20 border-t border-border pt-12">
      <h2 className="text-h2 font-semibold text-text">How it works</h2>
      <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s, i) => (
          <div key={s.n} className="relative rounded-card border border-border bg-panel p-5"
            style={reduced || !inView ? undefined : { animation: `fade-up 420ms var(--ease-out) ${i * 150}ms both` }}>
            <span className="num text-muted">{s.n}</span>
            <h3 className="mt-2 text-body font-semibold text-text">{s.title}</h3>
            <p className="mt-1 text-small text-secondary">{s.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function WhyQloo() {
  return (
    <section className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-2">
      <div className="rounded-card border border-border bg-panel p-6">
        <h3 className="text-body font-semibold text-text">A plain LLM can guess a city.</h3>
        <p className="mt-2 text-small text-secondary">Landfall shows the Qloo calls behind every number — affinity, not hallucination.</p>
      </div>
      <div className="rounded-card border border-border bg-panel p-6">
        <h3 className="text-body font-semibold text-text">See it for yourself.</h3>
        <p className="mt-2 text-small text-secondary">Run a plan, then compare it side by side with a plain LLM.</p>
      </div>
    </section>
  );
}

function FormSection({ index, title, children }) {
  return (
    <section className="rounded-card border border-border bg-panel p-5">
      <div className="mb-3 flex items-center gap-3">
        <span className="num text-muted">{index}</span>
        <h2 className="text-label text-muted">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Check({ size = 14, reduced }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" className="shrink-0 text-positive" aria-hidden="true">
      <path d="M2 7.5 L5.5 11 L12 3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        style={reduced ? undefined : { strokeDasharray: 16, strokeDashoffset: 16, animation: "check-draw 200ms var(--ease-out) forwards" }} />
    </svg>
  );
}
