import React, { useRef, useState } from "react";

const DEFAULT_CITIES = [
  "Lagos",
  "London",
  "Accra",
  "New York",
  "Abuja",
  "Los Angeles",
  "Paris",
  "Johannesburg",
];

export default function Home({ config, onRun, onError }) {
  const [artist, setArtist] = useState("");
  const [songId, setSongId] = useState(null);
  const [songName, setSongName] = useState(null);
  const [genre, setGenre] = useState("");
  const [cities, setCities] = useState(DEFAULT_CITIES);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  async function upload(file) {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    if (!res.ok) {
      onError("upload failed: " + (await res.text()));
      return null;
    }
    const data = await res.json();
    return data;
  }

  async function onFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    const up = await upload(f);
    setBusy(false);
    if (up) {
      setSongId(up.song_id);
      setSongName(up.name || f.name);
    }
  }

  async function useSample() {
    const s = config.sample_tracks?.[0];
    if (!s) return;
    setSongId(s.song_id);
    setSongName(s.name);
  }

  function toggleCity(c) {
    setCities((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
    );
  }

  function start() {
    if (!artist.trim()) {
      onError("Enter an artist name.");
      return;
    }
    onRun({ artist: artist.trim(), song_id: songId, genre: genre.trim() || null, cities });
  }

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Pick an artist. Drop a new song.</h1>
        <p className="text-sm text-muted">
          An agent uses Qloo taste data to predict how a track fits an artist's
          audience, which cities and collaborators to target, and which hook to clip.
        </p>
      </div>

      {/* Artist */}
      <Panel label="Artist">
        <input
          value={artist}
          onChange={(e) => setArtist(e.target.value)}
          placeholder="Search an artist, e.g. Tems"
          className="w-full rounded-md border border-border bg-raised px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          {config.sample_artists.map((a) => (
            <button
              key={a}
              onClick={() => setArtist(a)}
              className="rounded-full border border-border px-3 py-1 text-xs text-muted hover:border-accent hover:text-text"
            >
              {a}
            </button>
          ))}
        </div>
      </Panel>

      {/* Song */}
      <Panel label="New song">
        <div
          onClick={() => fileRef.current?.click()}
          className="cursor-pointer rounded-md border border-dashed border-border bg-panel px-4 py-8 text-center text-sm text-muted hover:border-accent"
        >
          {songName ? (
            <span className="text-text">{songName}</span>
          ) : (
            <span>Click to upload an mp3, wav, or m4a (max 25 MB) — or use a sample track.</span>
          )}
          <input ref={fileRef} type="file" accept=".mp3,.wav,.m4a" className="hidden" onChange={onFile} />
        </div>
        <div className="mt-3 flex items-center gap-4">
          {config.sample_tracks?.length > 0 && (
            <button
              onClick={useSample}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:border-accent hover:text-text"
            >
              Use sample track{config.sample_tracks[0] ? `: ${config.sample_tracks[0].name}` : ""}
            </button>
          )}
          <input
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
            placeholder="Genre tag (optional)"
            className="rounded-md border border-border bg-raised px-3 py-1.5 text-xs outline-none focus:border-accent"
          />
          {busy && <span className="text-xs text-muted">uploading…</span>}
        </div>
      </Panel>

      {/* Markets */}
      <Panel label="Candidate markets">
        <div className="flex flex-wrap gap-2">
          {DEFAULT_CITIES.map((c) => (
            <button
              key={c}
              onClick={() => toggleCity(c)}
              className={`rounded-full border px-3 py-1 text-xs ${
                cities.includes(c)
                  ? "border-accent bg-accent/10 text-text"
                  : "border-border text-muted hover:border-accent"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </Panel>

      <div className="flex items-center justify-between">
        <p className="max-w-md text-xs text-muted">
          Upload only songs you own or that are royalty free. Results are predicted
          fit and affinity estimates, not guaranteed.
        </p>
        <button
          onClick={start}
          className="rounded-md bg-accent px-6 py-2.5 text-sm font-semibold text-black hover:brightness-110"
        >
          Run
        </button>
      </div>
    </div>
  );
}

function Panel({ label, children }) {
  return (
    <section className="rounded-lg border border-border bg-panel p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">
        {label}
      </h2>
      {children}
    </section>
  );
}
