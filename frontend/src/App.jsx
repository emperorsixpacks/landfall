import React, { useEffect, useRef, useState } from "react";
import Home from "./components/Home.jsx";
import RunTimeline from "./components/RunTimeline.jsx";
import Results from "./components/Results.jsx";

export default function App() {
  const [view, setView] = useState("home");
  const [config, setConfig] = useState({ sample_artists: [], sample_tracks: [], youtube_audience_enabled: false });
  const [countries, setCountries] = useState([]);
  const [events, setEvents] = useState([]);
  const [liveMarkets, setLiveMarkets] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [prefill, setPrefill] = useState(null);
  const abortRef = useRef(null);

  useEffect(() => {
    fetch("/api/config").then((r) => r.json()).then(setConfig).catch(() => {});
    fetch("/api/countries").then((r) => r.json()).then(setCountries).catch(() => {});
  }, []);

  async function run(body) {
    setView("running");
    setEvents([]);
    setLiveMarkets([]);
    setResult(null);
    setError(null);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        let msg = "";
        try {
          const text = await res.text();
          try { msg = JSON.parse(text).detail || text; } catch { msg = text; }
        } catch {}
        setError(msg || `Request failed (${res.status})`);
        setView("home");
        return;
      }

      if (!res.body) {
        setError("No response stream");
        setView("home");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let gotFinal = false;
      let gotError = false;

      function handlePart(part) {
        const ev = parseSSE(part);
        if (!ev) return;
        if (ev.event === "event") {
          setEvents((prev) => [...prev, ev.data]);
          if (ev.data.market_scored) {
            const ms = ev.data.market_scored;
            setLiveMarkets((prev) => {
              const rest = prev.filter((m) => m.city !== ms.city);
              return [...rest, { city: ms.city, score: ms.score, status: ms.score == null ? "no_data" : "scored", reason: "", venues: [] }];
            });
          }
        } else if (ev.event === "final") {
          gotFinal = true;
          setResult(ev.data);
        } else if (ev.event === "error") {
          gotError = true;
          setError(ev.data.message || "run failed");
        }
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";
        for (const part of parts) handlePart(part);
      }

      // Flush the decoder and any trailing partial event before giving up.
      buffer += decoder.decode();
      if (buffer.trim()) {
        for (const part of buffer.split("\n\n")) handlePart(part);
      }

      if (!gotFinal && !gotError) {
        setError("The run ended without a result. Check the server logs.");
      }
    } catch (e) {
      if (controller.signal.aborted) {
        setView("home");
        return;
      }
      setError(String(e));
    }
    setView("results");
  }

  function cancelRun() {
    abortRef.current?.abort();
    setView("home");
  }

  const isMock = config.mode === "mock";

  return (
    <div className="min-h-screen bg-bg text-text flex flex-col">
      {/* Header — shared 1040px container, padding 24px */}
      <header className="border-b border-border py-4">
        <div className="mx-auto max-w-[1040px] px-6 flex items-center justify-between">
          <button
            onClick={() => setView("home")}
            className="flex items-center gap-2.5 text-left focus:outline-none focus:ring-1 focus:ring-accent rounded-sm"
            aria-label="Landfall home"
          >
            <img src="/landfall-lockup-dark.svg" alt="Landfall" className="h-7 w-auto" />
          </button>

          <div className="flex items-center gap-5 text-xs">
            <button
              onClick={() => setShowHowItWorks(true)}
              className="text-[#9AA0AC] hover:text-text transition-colors focus:outline-none focus:ring-1 focus:ring-accent rounded-sm"
            >
              How it works
            </button>

            <a
              href="https://github.com/emperorsixpacks/landfall"
              target="_blank"
              rel="noreferrer"
              className="text-[#9AA0AC] hover:text-text transition-colors focus:outline-none focus:ring-1 focus:ring-accent rounded-sm"
            >
              GitHub
            </a>

            {/* Status pill with tooltip */}
            <div
              title={isMock ? "Running in mock mode with bundled sample data" : "Connected to live Qloo taste graph API"}
              className="flex items-center gap-1.5 rounded-full border border-border bg-raised px-2.5 py-0.5 text-xs text-[#9AA0AC] cursor-help"
            >
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${isMock ? "bg-amber-400" : "bg-positive"}`} />
              <span className="num text-[11px]">{isMock ? "Sample data" : "Qloo live"}</span>
            </div>

            {view !== "home" && (
              <button
                onClick={() => setView("home")}
                className="rounded-md border border-border px-2.5 py-1 text-xs text-[#9AA0AC] hover:border-accent hover:text-text transition-colors focus:outline-none focus:ring-1 focus:ring-accent"
              >
                New run
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content — results is wider (1440px); home/running keep 1040px */}
      <main
        className={`mx-auto w-full flex-1 ${
          view === "results" ? "max-w-[1440px] px-6 py-8 pb-24" : "max-w-[1040px] px-6 py-8"
        }`}
      >
        {view === "home" && (
          <Home config={config} allCountries={countries} onRun={run} onError={setError} prefill={prefill} />
        )}
        {view === "running" && (
          <RunTimeline events={events} cities={countries} liveMarkets={liveMarkets} onCancel={cancelRun} />
        )}
        {view === "results" && (
          <Results
            result={result}
            events={events}
            cities={countries}
            error={error}
            onReset={() => { setPrefill(null); setView("home"); }}
            onEdit={(prefill) => { setPrefill(prefill); setView("home"); }}
          />
        )}
      </main>

      {/* Footer — shared 1040px container, padding 24px */}
      <footer className="border-t border-border py-6 mt-auto">
        <div className="mx-auto max-w-[1040px] px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-[#9AA0AC]">
          <p>Powered by Qloo taste data. Open source under MIT.</p>
          <p className="max-w-md sm:text-right">
            Upload only songs you own or that are royalty free. Results are predicted fit and affinity estimates, not guaranteed.
          </p>
        </div>
      </footer>

      {/* How it works modal (4 steps) */}
      {showHowItWorks && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onClick={() => setShowHowItWorks(false)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-border bg-panel p-6 shadow-xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h2 className="text-sm font-semibold text-text uppercase tracking-wider">How Landfall Works</h2>
              <button
                onClick={() => setShowHowItWorks(false)}
                className="text-[#9AA0AC] hover:text-text text-sm focus:outline-none"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3.5 text-xs text-[#9AA0AC]">
              <div>
                <span className="font-semibold text-text block mb-0.5">1. Identify</span>
                <p className="leading-relaxed">
                  Resolves the artist’s Qloo entity, home city, and catalog tags via YouTube Music.
                </p>
              </div>

              <div>
                <span className="font-semibold text-text block mb-0.5">2. Profile</span>
                <p className="leading-relaxed">
                  Extracts audience taste graph tags, demographic affinities, and cultural entities from Qloo.
                </p>
              </div>

              <div>
                <span className="font-semibold text-text block mb-0.5">3. Listen & Compare</span>
                <p className="leading-relaxed">
                  Analyzes acoustic features (tempo, key, loudness) and maps sound descriptors to catalog comparables.
                </p>
              </div>

              <div>
                <span className="font-semibold text-text block mb-0.5">4. Target & Score</span>
                <p className="leading-relaxed">
                  Queries Qloo geographic heatmaps across candidate cities, cuts 15–30s hook clips, and calculates fit in pure code.
                </p>
              </div>
            </div>

            <div className="pt-2 border-t border-border flex justify-end">
              <button
                onClick={() => setShowHowItWorks(false)}
                className="rounded-md bg-accent px-4 py-1.5 text-xs font-semibold text-black hover:brightness-110"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function parseSSE(part) {
  let event = "message";
  let data = "";
  for (const line of part.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (!data) return null;
  try {
    return { event, data: JSON.parse(data) };
  } catch {
    return null;
  }
}
