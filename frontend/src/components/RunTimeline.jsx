import React, { useMemo } from "react";
import GlobeContainer from "./GlobeContainer.jsx";
import { joinMarketsToCities } from "../lib/globeUtils";

export default function RunTimeline({ events = [], cities = [], liveMarkets = [] }) {
  const joined = useMemo(() => joinMarketsToCities(liveMarkets, cities), [liveMarkets, cities]);

  return (
    <div className="relative">
      {/* Background globe visual */}
      <div className="pointer-events-none absolute inset-0 opacity-25" aria-hidden="true">
        <GlobeContainer markets={joined} origin={null} interactive={false} height={420} />
      </div>

      <div className="relative space-y-4">
        {/* Status header */}
        <div className="flex items-center justify-between rounded-md border border-border bg-panel/90 p-3.5 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <Spinner />
            <h1 className="text-base font-semibold text-text">Planning the release</h1>
          </div>

          <div className="flex items-center gap-4 text-xs text-muted">
            <span className="num">{events.length} step(s)</span>
            {joined.length > 0 && (
              <span className="num">{joined.length} market(s) scored</span>
            )}
          </div>
        </div>

        {/* Step rows */}
        <div className="space-y-1.5">
          {events.length === 0 && (
            <p className="rounded-md border border-border bg-panel/90 p-4 text-sm text-muted">
              Starting agent...
            </p>
          )}
          {events.map((e, i) => (
            <Row key={i} e={e} index={i} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({ e, index }) {
  const isOk = e.status === "ok";
  const isErr = e.status === "error";
  const color = isOk ? "text-positive" : isErr ? "text-red-400" : "text-muted";

  return (
    <div className="flex items-start gap-3 rounded-md border border-border bg-panel/90 p-3 backdrop-blur-sm text-xs">
      <span className="num w-6 shrink-0 text-muted/60">{index + 1}</span>
      <span className="w-20 shrink-0 font-medium tracking-wide uppercase text-muted text-[10px] mt-0.5">
        {e.stage}
      </span>
      <span className="w-32 shrink-0 font-mono text-accent truncate">
        {e.tool}
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm text-text leading-snug">{e.result_summary}</p>
        {e.why && <p className="text-xs text-muted leading-relaxed">{e.why}</p>}
      </div>
      <div className="shrink-0 text-right">
        <span className={`num text-xs ${color}`}>{e.status}</span>
        <div className="num text-[10px] text-muted">{typeof e.latency_ms === "number" ? `${e.latency_ms}ms` : ""}</div>
      </div>
      <span
        className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${
          e.source === "fallback" ? "bg-raised text-muted" : "bg-accent/15 text-accent"
        }`}
      >
        {e.source || "agent"}
      </span>
    </div>
  );
}

function Spinner() {
  return (
    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
  );
}
