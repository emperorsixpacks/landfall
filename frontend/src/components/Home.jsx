import React, { useEffect, useMemo, useRef, useState } from "react";
import GlobeContainer from "./GlobeContainer.jsx";
import { formatTime, joinMarketsToCities, prefersReducedMotion } from "../lib/globeUtils";

const ARTIST_DIRECTORY = [
  { name: "Tems", type: "Artist · Contemporary R&B / Afrobeats" },
  { name: "Burna Boy", type: "Artist · Afro-fusion / Reggae" },
  { name: "Rema", type: "Artist · Afrorave / Pop" },
  { name: "Asake", type: "Artist · Amapiano / Fuji" },
  { name: "Ayra Starr", type: "Artist · Afropop / R&B" },
  { name: "Wizkid", type: "Artist · Afrobeats" },
  { name: "Davido", type: "Artist · Afrobeats / Pop" },
  { name: "Omah Lay", type: "Artist · Afro-fusion" },
  { name: "Fireboy DML", type: "Artist · Afro-R&B" },
  { name: "Tiwa Savage", type: "Artist · Afropop" },
  { name: "Central Cee", type: "Artist · UK Drill / Hip-Hop" },
  { name: "Drake", type: "Artist · Hip-Hop / R&B" },
  { name: "Kendrick Lamar", type: "Artist · Hip-Hop" },
  { name: "Billie Eilish", type: "Artist · Alt-Pop" },
  { name: "SZA", type: "Artist · Contemporary R&B" },
  { name: "The Weeknd", type: "Artist · Synth-pop / R&B" },
  { name: "Beyoncé", type: "Artist · Pop / R&B" },
  { name: "Taylor Swift", type: "Artist · Pop / Folk" },
  { name: "Bad Bunny", type: "Artist · Reggaeton / Latin Trap" },
  { name: "Rosalía", type: "Artist · Flamenco Pop" },
  { name: "CKay", type: "Artist · Emo-Afrobeats" },
  { name: "Victony", type: "Artist · Afropop" },
  { name: "Ruger", type: "Artist · Dancehall / Afrobeats" },
  { name: "Black Sherif", type: "Artist · Highlife / Drill" },
  { name: "Adekunle Gold", type: "Artist · Afro-pop / Highlife" },
];

const PRESETS = [
  { label: "Global", cities: ["Lagos", "London", "New York", "Paris", "Tokyo", "Johannesburg", "Los Angeles", "Accra"] },
  { label: "West Africa", cities: ["Lagos", "Abuja", "Accra", "Dakar", "Abidjan", "Port Harcourt", "Benin City"] },
  { label: "Europe", cities: ["London", "Paris", "Berlin", "Amsterdam", "Madrid", "Lisbon", "Stockholm"] },
  { label: "North America", cities: ["New York", "Los Angeles", "Atlanta", "Toronto", "Chicago", "Miami"] },
];

export default function Home({ config, allCities = [], onRun, onError }) {
  // Artist state
  const [artistQuery, setArtistQuery] = useState("");
  const [debouncedArtistQuery, setDebouncedArtistQuery] = useState("");
  const [resolvedArtist, setResolvedArtist] = useState(null);
  const [showArtistDropdown, setShowArtistDropdown] = useState(false);
  const artistInputRef = useRef(null);

  // Track state
  const [songId, setSongId] = useState(null);
  const [songName, setSongName] = useState(null);
  const [duration, setDuration] = useState(null);
  const [isSampleTrack, setIsSampleTrack] = useState(false);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [genre, setGenre] = useState("");
  const [uploadBusy, setUploadBusy] = useState(false);
  const fileInputRef = useRef(null);

  // Markets state
  const [cities, setCities] = useState(PRESETS[1].cities); // Default West Africa
  const [activePreset, setActivePreset] = useState("West Africa");
  const [marketSearch, setMarketSearch] = useState("");

  // Refs & accessibility
  const runBtnRef = useRef(null);
  const mobileRunBtnRef = useRef(null);
  const reducedMotion = prefersReducedMotion();

  // Debounce artist query (250ms)
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedArtistQuery(artistQuery.trim());
    }, 250);
    return () => clearTimeout(handler);
  }, [artistQuery]);

  // Combined artist catalog
  const artistList = useMemo(() => {
    const names = new Set(ARTIST_DIRECTORY.map((a) => a.name.toLowerCase()));
    const extra = (config.sample_artists || [])
      .filter((name) => !names.has(name.toLowerCase()))
      .map((name) => ({ name, type: "Artist" }));
    return [...ARTIST_DIRECTORY, ...extra];
  }, [config.sample_artists]);

  // Filtered artist matches
  const artistMatches = useMemo(() => {
    if (!debouncedArtistQuery) return [];
    const q = debouncedArtistQuery.toLowerCase();
    return artistList.filter((a) => a.name.toLowerCase().includes(q));
  }, [artistList, debouncedArtistQuery]);

  // Handle artist selection
  function handleSelectArtist(name) {
    setResolvedArtist(name);
    setArtistQuery(name);
    setShowArtistDropdown(false);
  }

  function handleChangeArtist() {
    setResolvedArtist(null);
    setArtistQuery("");
    setShowArtistDropdown(false);
    setTimeout(() => artistInputRef.current?.focus(), 50);
  }

  // Handle file upload
  async function handleFileUpload(file) {
    if (!file) return;
    setUploadBusy(true);
    const fd = new FormData();
    fd.append("file", file);

    // Read duration client-side for immediate display without layout shift
    try {
      const audio = new Audio();
      audio.src = URL.createObjectURL(file);
      audio.onloadedmetadata = () => {
        if (audio.duration && !isNaN(audio.duration)) {
          setDuration(Math.round(audio.duration));
        }
      };
    } catch {}

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

  function handleUseSampleTrack() {
    const s = config.sample_tracks?.[0];
    if (s) {
      setSongId(s.song_id);
      setSongName(s.name);
    } else {
      setSongId("sample_demo_track");
      setSongName("Sample Demo Track");
    }
    setDuration(184); // 3:04
    setIsSampleTrack(true);
    setRightsConfirmed(true);
  }

  function handleRemoveSong() {
    setSongId(null);
    setSongName(null);
    setDuration(null);
    setIsSampleTrack(false);
    setRightsConfirmed(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // Markets handling
  function handleSelectPreset(preset) {
    setActivePreset(preset.label);
    setCities(preset.cities.slice(0, 12));
  }

  function toggleCity(city) {
    setActivePreset(null);
    setCities((prev) => {
      if (prev.includes(city)) {
        return prev.filter((c) => c !== city);
      }
      if (prev.length >= 12) return prev; // max 12
      return [...prev, city];
    });
  }

  const cityPool = useMemo(() => {
    return allCities.length > 0
      ? allCities
      : PRESETS[0].cities.map((c) => ({ city: c, country: "" }));
  }, [allCities]);

  const displayedCities = useMemo(() => {
    if (!marketSearch.trim()) {
      // show current selected cities plus remaining default preset cities
      const set = new Set(cities);
      PRESETS[0].cities.forEach((c) => set.add(c));
      return cityPool.filter((item) => set.has(item.city));
    }
    const q = marketSearch.toLowerCase();
    return cityPool.filter(
      (item) => item.city.toLowerCase().includes(q) || (item.country && item.country.toLowerCase().includes(q))
    );
  }, [cityPool, cities, marketSearch]);

  // Joined markets for the small live preview globe
  const previewJoinedMarkets = useMemo(() => {
    const base = cities.map((c) => ({ city: c, score: 85, status: "scored" }));
    return joinMarketsToCities(base, allCities);
  }, [cities, allCities]);

  // Readiness checklist calculations
  const hasArtist = Boolean(resolvedArtist);
  const hasTrack = Boolean(songId);
  const hasRights = isSampleTrack || rightsConfirmed;
  const hasMarkets = cities.length > 0;
  const isReady = hasArtist && hasTrack && hasRights && hasMarkets;

  // Missing items description
  const missingItems = [];
  if (!hasArtist) missingItems.push("Artist");
  if (!hasTrack) missingItems.push("Track");
  if (!hasRights) missingItems.push("Rights confirmation");
  if (!hasMarkets) missingItems.push("Target markets");

  function start() {
    if (!isReady) return;
    onRun({
      artist: resolvedArtist.trim(),
      song_id: songId,
      genre: genre.trim() || null,
      cities,
    });
  }

  // "Try an example" button: fills Tems, sample track, West Africa preset, then focuses Run
  function handleTryExample() {
    setResolvedArtist("Tems");
    setArtistQuery("Tems");
    setShowArtistDropdown(false);

    const s = config.sample_tracks?.[0];
    if (s) {
      setSongId(s.song_id);
      setSongName(s.name);
    } else {
      setSongId("sample_demo_tems");
      setSongName("Tems - Free Mind (Sample)");
    }
    setDuration(192); // 3:12
    setIsSampleTrack(true);
    setRightsConfirmed(true);
    setGenre("Afrobeats");

    const westAfrica = PRESETS[1];
    setCities(westAfrica.cities);
    setActivePreset(westAfrica.label);

    setTimeout(() => {
      runBtnRef.current?.focus();
      mobileRunBtnRef.current?.focus();
    }, 60);
  }

  // Keyboard shortcut: Cmd+Enter or Ctrl+Enter runs when ready
  useEffect(() => {
    function onKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        if (isReady) {
          e.preventDefault();
          start();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isReady, resolvedArtist, songId, genre, cities]);

  return (
    <div className="space-y-8">
      {/* HERO SECTION */}
      <div className="space-y-3">
        <h1 className="text-[32px] font-semibold leading-tight text-text tracking-tight">
          Where will your next song land?
        </h1>
        <p className="text-[16px] text-[#9AA0AC] leading-relaxed max-w-2xl">
          Pick an artist, drop an unreleased track, and an agent uses Qloo taste data
          to predict audience fit, the best markets, and the clip to post.
        </p>

        <div className="pt-1">
          <button
            type="button"
            onClick={handleTryExample}
            className="rounded-md border border-border px-3.5 py-1.5 text-xs font-medium text-text hover:border-accent hover:text-accent transition-colors focus:outline-none focus:ring-1 focus:ring-accent"
          >
            Try an example
          </button>
        </div>
      </div>

      {/* TWO COLUMN LAYOUT: Left flex form, Right 360px sticky preview */}
      <div className="flex flex-col desktop:flex-row desktop:items-start gap-8">
        {/* Left column: Form sections */}
        <div className="flex-1 min-w-0 space-y-6">
          {/* 1. Artist Typeahead */}
          <section className="rounded-lg border border-border bg-panel p-4 space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#9AA0AC]">
              1. Artist
            </h2>

            {/* Fixed height container to prevent layout shift */}
            <div className="relative min-h-[42px]">
              {resolvedArtist ? (
                <div className="flex h-[42px] items-center justify-between rounded-md border border-border bg-raised px-3.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-text">{resolvedArtist}</span>
                    <span className="flex items-center gap-1 text-xs text-positive font-medium">
                      <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      <span>Found in Qloo</span>
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleChangeArtist}
                    className="text-xs text-[#5B9DFF] hover:underline focus:outline-none focus:ring-1 focus:ring-accent rounded-sm"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <input
                    ref={artistInputRef}
                    value={artistQuery}
                    onChange={(e) => {
                      setArtistQuery(e.target.value);
                      setShowArtistDropdown(true);
                    }}
                    onFocus={() => {
                      if (artistQuery.trim()) setShowArtistDropdown(true);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        if (artistMatches.length > 0) {
                          e.preventDefault();
                          handleSelectArtist(artistMatches[0].name);
                        }
                      } else if (e.key === "Escape") {
                        setShowArtistDropdown(false);
                      }
                    }}
                    placeholder="Search an artist, e.g. Tems"
                    className="w-full h-[42px] rounded-md border border-border bg-raised px-3 py-2 text-sm text-text placeholder-[#7A808C] outline-none focus:ring-1 focus:ring-accent focus:border-accent transition-colors"
                  />

                  {/* Typeahead Dropdown */}
                  {showArtistDropdown && debouncedArtistQuery && (
                    <div className="absolute top-[46px] left-0 right-0 z-30 max-h-56 overflow-y-auto rounded-md border border-border bg-panel shadow-xl divide-y divide-border/60">
                      {artistMatches.length > 0 ? (
                        artistMatches.map((m) => (
                          <button
                            key={m.name}
                            type="button"
                            onClick={() => handleSelectArtist(m.name)}
                            className="flex w-full items-baseline justify-between px-3.5 py-2 text-left text-xs hover:bg-raised transition-colors focus:bg-raised focus:outline-none"
                          >
                            <span className="font-medium text-text">{m.name}</span>
                            <span className="text-[#9AA0AC] text-[11px] truncate max-w-[200px]">
                              {m.type}
                            </span>
                          </button>
                        ))
                      ) : (
                        <div className="px-3.5 py-2.5 text-xs text-[#9AA0AC]">
                          No match found. Try another spelling.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* 2. New Song */}
          <section className="rounded-lg border border-border bg-panel p-4 space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#9AA0AC]">
              2. New song
            </h2>

            {/* Dropzone / Active Song Card (h-[120px] fixed height to eliminate layout shift) */}
            <div className="min-h-[120px]">
              {songName ? (
                <div className="h-[120px] rounded-md border border-border bg-raised p-3.5 flex flex-col justify-between">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="block text-sm font-medium text-text truncate max-w-sm">
                        {songName}
                      </span>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="num text-xs text-[#9AA0AC]">
                          {duration ? formatTime(duration) : "0:30"}
                        </span>
                        {isSampleTrack && (
                          <span className="rounded bg-panel border border-border px-1.5 py-0.2 text-[10px] text-[#9AA0AC]">
                            sample
                          </span>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleRemoveSong}
                      className="text-xs text-[#9AA0AC] hover:text-red-400 focus:outline-none focus:ring-1 focus:ring-accent rounded-sm"
                    >
                      Remove
                    </button>
                  </div>

                  {/* Mini waveform representation */}
                  <div className="flex items-center justify-between gap-3 pt-2">
                    <MiniWaveform />
                    <span className="num text-[11px] text-[#9AA0AC]">Audio loaded</span>
                  </div>
                </div>
              ) : (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const f = e.dataTransfer?.files?.[0];
                    if (f) handleFileUpload(f);
                  }}
                  className="h-[120px] cursor-pointer rounded-md border border-dashed border-border bg-panel hover:border-accent p-3.5 flex flex-col items-center justify-center text-center transition-colors focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".mp3,.wav,.m4a"
                    className="hidden"
                    onChange={(e) => handleFileUpload(e.target.files?.[0])}
                  />

                  <svg className="h-5 w-5 text-[#9AA0AC] mb-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>

                  <span className="text-xs font-medium text-text">
                    {uploadBusy ? "Uploading track..." : "Drop a track here or browse"}
                  </span>
                  <span className="text-[11px] text-[#9AA0AC] mt-0.5">
                    MP3, WAV or M4A, up to 25 MB and 8 minutes
                  </span>
                </div>
              )}
            </div>

            {/* Secondary Sample Button */}
            {!songName && (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleUseSampleTrack}
                  className="rounded-md border border-border bg-raised px-3 py-1.5 text-xs text-text hover:border-accent transition-colors focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  Use a sample track
                </button>
              </div>
            )}

            {/* Genre (optional) Input */}
            <div className="space-y-1 pt-1">
              <label htmlFor="genre-input" className="block text-xs font-medium text-text">
                Genre <span className="text-[#9AA0AC] font-normal">(optional)</span>
              </label>
              <input
                id="genre-input"
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                placeholder="e.g. Afrobeats"
                className="w-full rounded-md border border-border bg-raised px-3 py-1.5 text-xs text-text placeholder-[#7A808C] outline-none focus:ring-1 focus:ring-accent focus:border-accent transition-colors"
              />
              <p className="text-[11px] text-[#9AA0AC]">Helps pick comparable artists</p>
            </div>

            {/* Required rights checkbox (only for uploaded files, not required for samples) */}
            {songName && !isSampleTrack && (
              <div className="pt-2">
                <label className="flex items-center gap-2 cursor-pointer text-xs text-[#9AA0AC] select-none">
                  <input
                    type="checkbox"
                    checked={rightsConfirmed}
                    onChange={(e) => setRightsConfirmed(e.target.checked)}
                    className="rounded border-border accent-[#5B9DFF] focus:ring-1 focus:ring-accent"
                  />
                  <span>I own this track or it is royalty free.</span>
                </label>
              </div>
            )}
          </section>

          {/* 3. Candidate Markets */}
          <section className="rounded-lg border border-border bg-panel p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#9AA0AC]">
                3. Markets
              </h2>
              <span className="num text-xs text-[#9AA0AC]">
                {cities.length} of 12
              </span>
            </div>

            {/* Presets Segmented Control & Search */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex rounded-md border border-border bg-raised p-0.5 text-xs">
                {PRESETS.map((p) => {
                  const isActive = activePreset === p.label;
                  return (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => handleSelectPreset(p)}
                      className={`rounded px-2.5 py-1 text-xs font-medium transition-colors focus:outline-none focus:ring-1 focus:ring-accent ${
                        isActive
                          ? "bg-panel text-text shadow-sm"
                          : "text-[#9AA0AC] hover:text-text"
                      }`}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>

              {/* City search field (min-width 200px) */}
              <div className="min-w-[200px]">
                <input
                  value={marketSearch}
                  onChange={(e) => setMarketSearch(e.target.value)}
                  placeholder="Search cities..."
                  className="w-full rounded-md border border-border bg-raised px-2.5 py-1 text-xs text-text placeholder-[#7A808C] outline-none focus:ring-1 focus:ring-accent focus:border-accent transition-colors"
                />
              </div>
            </div>

            {/* City Chips */}
            <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto pt-1">
              {displayedCities.map((item) => {
                const isSelected = cities.includes(item.city);
                return (
                  <button
                    key={item.city}
                    type="button"
                    onClick={() => toggleCity(item.city)}
                    className={`rounded-full px-3 py-1 text-xs transition-colors flex items-center gap-1.5 focus:outline-none focus:ring-1 focus:ring-accent ${
                      isSelected
                        ? "bg-[#5B9DFF]/15 border border-[#5B9DFF]/40 text-text font-normal"
                        : "border border-border text-[#9AA0AC] hover:border-accent hover:text-text font-normal"
                    }`}
                  >
                    {isSelected && (
                      <svg className="h-3 w-3 text-[#5B9DFF] shrink-0" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                    <span>{item.city}</span>
                    {item.country && (
                      <span className="text-[10px] text-[#9AA0AC]/70">· {item.country}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        </div>

        {/* Right column (Desktop 1100px+): Sticky 360px Preview Panel */}
        <aside className="w-[360px] shrink-0 sticky top-6 self-start space-y-4 rounded-lg border border-border bg-panel p-4 desktop:block hidden">
          {/* Mini Preview Globe (hidden under reduced motion) */}
          {!reducedMotion ? (
            <div className="h-[180px] rounded-md border border-border bg-raised overflow-hidden relative">
              <GlobeContainer
                markets={previewJoinedMarkets}
                origin={null}
                interactive={false}
                height={180}
              />
              <span className="absolute bottom-1 right-2 text-[10px] num text-[#9AA0AC]">
                {cities.length} market(s)
              </span>
            </div>
          ) : (
            <div className="h-[120px] rounded-md border border-border bg-raised p-3 flex flex-col justify-center text-center">
              <span className="text-xs text-text font-medium">Selected Markets</span>
              <span className="num text-xs text-[#9AA0AC] mt-1">{cities.join(", ")}</span>
            </div>
          )}

          {/* Readiness Checklist */}
          <div className="space-y-2 border-b border-border pb-3 text-xs">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9AA0AC] block">
              Readiness
            </span>

            <ul className="space-y-1.5">
              <CheckItem label="Artist chosen" ready={hasArtist} />
              <CheckItem label="Track ready" ready={hasTrack} />
              <CheckItem label="Rights confirmed" ready={hasRights} />
              <CheckItem label="Markets selected" ready={hasMarkets} />
            </ul>
          </div>

          {/* Desktop Run Button */}
          <div className="space-y-1.5">
            <button
              ref={runBtnRef}
              type="button"
              disabled={!isReady}
              onClick={start}
              className={`w-full py-2.5 rounded-md font-semibold text-sm transition-all text-center focus:outline-none focus:ring-2 focus:ring-accent ${
                isReady
                  ? "bg-[#5B9DFF] text-black hover:brightness-110 active:scale-98 cursor-pointer shadow-md"
                  : "bg-raised border border-border text-[#9AA0AC] opacity-60 cursor-not-allowed"
              }`}
            >
              Plan the release
            </button>

            {!isReady ? (
              <p className="text-[11px] text-[#9AA0AC] text-center">
                Missing: {missingItems.join(" · ")}
              </p>
            ) : (
              <p className="text-[11px] text-[#9AA0AC] text-center num">
                Press ⌘/Ctrl+Enter to run
              </p>
            )}
          </div>

          {/* What you'll get */}
          <div className="pt-2 space-y-2 border-t border-border text-xs">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9AA0AC] block">
              What you'll get
            </span>

            <div className="space-y-1.5 text-xs text-[#9AA0AC]">
              <div className="flex items-center gap-2">
                <span className="text-text">•</span>
                <span>Fit score (catalog overlap & affinity)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-text">•</span>
                <span>Markets on a 3D globe</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-text">•</span>
                <span>Clips with captions (15–30s hooks)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-text">•</span>
                <span>Collaborators from Qloo taste graph</span>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* Sticky Bottom Bar for screens below 1100px */}
      <div className="desktop:hidden fixed bottom-0 left-0 right-0 z-40 bg-panel/95 border-t border-border px-6 py-3 backdrop-blur-md">
        <div className="mx-auto max-w-[1040px] flex items-center justify-between gap-4">
          <div className="text-xs text-[#9AA0AC] truncate">
            {!isReady ? (
              <span>Missing: {missingItems.join(", ")}</span>
            ) : (
              <span className="text-positive font-medium">Ready to plan</span>
            )}
          </div>

          <button
            ref={mobileRunBtnRef}
            type="button"
            disabled={!isReady}
            onClick={start}
            className={`px-5 py-2 rounded-md font-semibold text-sm transition-all focus:outline-none focus:ring-1 focus:ring-accent ${
              isReady
                ? "bg-[#5B9DFF] text-black hover:brightness-110 active:scale-98"
                : "bg-raised border border-border text-[#9AA0AC] opacity-60 cursor-not-allowed"
            }`}
          >
            Plan the release
          </button>
        </div>
      </div>
    </div>
  );
}

function CheckItem({ label, ready }) {
  return (
    <li className="flex items-center justify-between text-xs">
      <span className={ready ? "text-text" : "text-[#9AA0AC]"}>{label}</span>
      {ready ? (
        <span className="text-positive font-semibold">✓</span>
      ) : (
        <span className="text-[#7A808C]">○</span>
      )}
    </li>
  );
}

function MiniWaveform() {
  const heights = [30, 45, 60, 80, 55, 70, 90, 100, 85, 75, 95, 65, 50, 70, 85, 60, 75, 90, 80, 65, 50, 40, 60, 75, 90, 85, 70, 55, 40, 25];
  return (
    <svg className="h-5 w-36 text-accent shrink-0" viewBox="0 0 144 20" fill="currentColor">
      {heights.map((h, i) => (
        <rect
          key={i}
          x={i * 4.8}
          y={(20 - (h / 100) * 16) / 2}
          width="2.4"
          height={(h / 100) * 16}
          rx="1"
        />
      ))}
    </svg>
  );
}
