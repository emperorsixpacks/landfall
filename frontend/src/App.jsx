import React, { useEffect, useState } from "react";
import Home from "./components/Home.jsx";
import RunTimeline from "./components/RunTimeline.jsx";
import Results from "./components/Results.jsx";

export default function App() {
  const [view, setView] = useState("home");
  const [config, setConfig] = useState({ sample_artists: [], sample_tracks: [], youtube_audience_enabled: false });
  const [cities, setCities] = useState([]);
  const [events, setEvents] = useState([]);
  const [liveMarkets, setLiveMarkets] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("/api/config").then((r) => r.json()).then(setConfig).catch(() => {});
    fetch("/api/cities").then((r) => r.json()).then(setCities).catch(() => {});
  }, []);

  async function run(body) {
    setView("running");
    setEvents([]);
    setLiveMarkets([]);
    setResult(null);
    setError(null);

    const res = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.body) {
      setError("No response stream");
      setView("home");
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";
        for (const part of parts) {
          const ev = parseSSE(part);
          if (!ev) continue;
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
            setResult(ev.data);
          } else if (ev.event === "error") {
            setError(ev.data.message || "run failed");
          }
        }
      }
    } catch (e) {
      setError(String(e));
    }
    setView("results");
  }

  return (
    <div className="min-h-screen bg-bg text-text">
      <header className="border-b border-border px-6 py-4">
        <span className="text-lg font-semibold tracking-tight">Landfall</span>
        <span className="ml-2 text-xs text-muted">agentic release planner</span>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {view === "home" && (
          <Home config={config} onRun={run} onError={setError} />
        )}
        {view === "running" && (
          <RunTimeline events={events} cities={cities} liveMarkets={liveMarkets} />
        )}
        {view === "results" && (
          <Results
            result={result}
            events={events}
            cities={cities}
            error={error}
            onReset={() => setView("home")}
          />
        )}
      </main>
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
