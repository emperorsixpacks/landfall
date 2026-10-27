import React, { useMemo } from "react";
import GlobeContainer from "./GlobeContainer.jsx";
import { joinMarketsToCities } from "../lib/globeUtils";

export default function RunTimeline({ events, cities = [], liveMarkets = [] }) {
  const joined = useMemo(() => joinMarketsToCities(liveMarkets, cities), [liveMarkets, cities]);

  return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-0 opacity-25" aria-hidden="true">
        <GlobeContainer markets={joined} origin={null} interactive={false} height={420} />
      </div>

      <div className="relative space-y-6">
        <div className="flex items-center gap-3 rounded-md border border-border bg-panel/80 p-3 backdrop-blur-sm">
          <Spinner />
          <h1 className="text-xl font-semibold">Planning the release</h1>
          <span className="text-xs text-muted">{events.length} step(s)</span>
          {joined.length > 0 && (
            <span className="text-xs text-muted">{joined.length} market(s) scored</span>
          )}
        </div>

        <div className="space-y-2">
          {events.length === 0 && <p className="text-sm text-muted">Starting…</p>}
          {events.map((e, i) => (
            <Row key={i} e={e} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({ e }) {
  const color = e.status === "ok" ? "text-positive" : e.status === "error" ? "text-red-400" : "text-muted";
  return (
    <div className="flex items-start gap-3 rounded-md border border-border bg-panel/90 p-3 backdrop-blur-sm">
      <span className="mt-0.5 w-20 shrink-0 text-[10px] font-semibold tracking-wide text-muted">
        {e.stage}
      </span>
      <span className="mt-0.5 w-36 shrink-0 font-mono text-xs text-accent">{e.tool}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-text">{e.result_summary}</p>
        {e.why && <p className="text-xs text-muted">{e.why}</p>}
      </div>
      <div className="shrink-0 text-right">
        <span className={`num text-xs ${color}`}>{e.status}</span>
        {typeof e.latency_ms === "number" && (
          <div className="num text-[10px] text-muted">{e.latency_ms}ms</div>
        )}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
  );
}
