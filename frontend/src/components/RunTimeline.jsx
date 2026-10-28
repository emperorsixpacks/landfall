import React, { useEffect, useMemo, useState } from "react";
import GlobeContainer from "./GlobeContainer.jsx";
import { joinMarketsToCities } from "../lib/globeUtils";
import { useReducedMotion } from "../hooks/useMotion";

const STAGES = ["IDENTIFY", "PROFILE", "LISTEN", "BRIDGE", "TARGET", "CLIP", "SCORE"];

function fmtClock(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function isDuplicate(e) {
  return (e.source === "fallback" || e.status === "fallback") && /duplicate/i.test(e.result_summary || "");
}

export default function RunTimeline({ events = [], cities = [], liveMarkets = [], onCancel }) {
  const joined = useMemo(() => joinMarketsToCities(liveMarkets, cities), [liveMarkets, cities]);
  const reduced = useReducedMotion();

  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const { visible, dupCount } = useMemo(() => {
    const dups = events.filter(isDuplicate);
    const vis = events.filter((e) => !isDuplicate(e));
    return { visible: vis, dupCount: dups.length };
  }, [events]);

  const currentStage = visible.length ? visible[visible.length - 1].stage : "IDENTIFY";
  const doneStages = useMemo(() => new Set(visible.map((e) => e.stage)), [visible]);

  return (
    <div className="relative" aria-live="polite">
      {/* Background globe (dimmed, markets rise as they score) */}
      <div className="pointer-events-none absolute inset-0 opacity-20" aria-hidden="true">
        <GlobeContainer markets={joined} origin={null} interactive={false} height={440} />
      </div>

      <div className="relative space-y-5">
        {/* Header: title, elapsed, cancel */}
        <div className="flex items-center justify-between">
          <h1 className="text-h2 font-semibold text-text">Planning the release</h1>
          <div className="flex items-center gap-4">
            <span className="num text-secondary">{fmtClock(elapsed)}</span>
            {onCancel && (
              <button onClick={onCancel} className="text-small text-muted hover:text-text transition-colors">
                Cancel
              </button>
            )}
          </div>
        </div>

        {/* Stage rail */}
        <StageRail stages={STAGES} current={currentStage} done={doneStages} reduced={reduced} />

        {/* Timeline rows */}
        <div className="space-y-1.5">
          {visible.length === 0 && (
            <p className="rounded-lg border border-border bg-panel p-4 text-body text-muted">
              Starting the agent…
            </p>
          )}
          {visible.map((e, i) => (
            <Row key={`${e.step}-${i}`} e={e} index={i} reduced={reduced} />
          ))}
          <WorkingRow visible={visible.length > 0} reduced={reduced} />
        </div>

        {dupCount > 0 && <SkippedDuplicates count={dupCount} />}

        {/* Live stats */}
        <div className="flex items-center gap-6 text-small text-muted">
          <span className="num">{visible.length} steps</span>
          {joined.length > 0 && <span className="num">{joined.length} markets scored</span>}
        </div>
      </div>
    </div>
  );
}

function StageRail({ stages, current, done, reduced }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {stages.map((s) => {
        const isCurrent = s === current;
        const isDone = done.has(s);
        return (
          <div
            key={s}
            className={`relative flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-label transition-colors ${
              isCurrent
                ? "border-accent bg-accent/10 text-accent"
                : isDone
                  ? "border-border bg-raised text-positive"
                  : "border-border text-muted"
            }`}
          >
            {isDone && <Check size={10} reduced={reduced} />}
            <span>{s.toLowerCase()}</span>
            {isCurrent && !reduced && (
              <span
                className="absolute -bottom-px left-2 right-2 h-px bg-accent"
                style={{ animation: "draw-stroke 400ms var(--ease-out)" }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function Row({ e, index, reduced }) {
  const isOk = e.status === "ok";
  const isErr = e.status === "error";
  const market = e.market_scored;

  return (
    <div
      className="relative flex items-start gap-3 rounded-lg border border-border bg-panel p-3 text-small"
      style={reduced ? undefined : { animation: "fade-up 320ms var(--ease-out) both" }}
    >
      <span className="num w-6 shrink-0 pt-0.5 text-muted">{String(index + 1).padStart(2, "0")}</span>

      <span className="w-20 shrink-0 rounded bg-raised px-1.5 py-0.5 text-center text-label text-muted">
        {e.stage.toLowerCase()}
      </span>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-text">{e.tool}</span>
          <SourceBadge source={e.source} />
        </div>
        <p className="text-text leading-snug">{e.result_summary}</p>

        {e.tool === "analyze_audio" && e.status === "ok" && <MiniWaveform reduced={reduced} />}

        {e.tool === "sound_to_tags" && <TagChips summary={e.result_summary} reduced={reduced} />}

        {market && (
          <div className="flex items-center gap-2">
            <span className="text-muted">{market.city}</span>
            <div className="h-1.5 w-40 overflow-hidden rounded-full bg-raised">
              <div
                className={`h-full rounded-full ${scoreColor(market.score)}`}
                style={{ width: `${market.score ?? 0}%`, transition: "width 600ms var(--ease-out)" }}
              />
            </div>
            <span className="num text-secondary">{market.score ?? "—"}</span>
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        {isOk && <Check size={14} reduced={reduced} />}
        {isErr && <span className="text-danger">×</span>}
        <span className={`num ${isOk ? "text-positive" : isErr ? "text-danger" : "text-muted"}`}>
          {e.status}
        </span>
        <span className="num text-muted">{typeof e.latency_ms === "number" ? `${e.latency_ms}ms` : ""}</span>
      </div>
    </div>
  );
}

function WorkingRow({ visible, reduced }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 text-small text-muted">
      <Spinner reduced={reduced} />
      <span>Working…</span>
    </div>
  );
}

function SkippedDuplicates({ count }) {
  return (
    <details className="group">
      <summary className="cursor-pointer text-small text-muted hover:text-text">
        {count} duplicate {count === 1 ? "call" : "calls"} skipped
      </summary>
    </details>
  );
}

function SourceBadge({ source }) {
  const isSystem = source === "fallback" || source === "system";
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-label ${
        isSystem ? "bg-raised text-muted" : "bg-accent/15 text-accent"
      }`}
    >
      {isSystem ? "system" : "agent"}
    </span>
  );
}

function Spinner({ reduced }) {
  return (
    <span
      className={`inline-block h-3.5 w-3.5 rounded-full border-2 border-accent border-t-transparent ${
        reduced ? "" : "animate-spin"
      }`}
    />
  );
}

function Check({ size = 14, reduced }) {
  const dur = reduced ? 0 : 200;
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" className="shrink-0 text-positive" aria-hidden="true">
      <path
        d="M2 7.5 L5.5 11 L12 3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={reduced ? undefined : { strokeDasharray: 16, strokeDashoffset: 16, animation: `check-draw ${dur}ms var(--ease-out) forwards` }}
      />
    </svg>
  );
}

function MiniWaveform({ reduced }) {
  const bars = [0.3, 0.6, 0.45, 0.9, 0.5, 0.75, 0.4, 0.85, 0.55, 0.7, 0.35, 0.8, 0.5, 0.65, 0.4, 0.6];
  return (
    <div className="flex h-6 items-end gap-0.5" aria-hidden="true">
      {bars.map((h, i) => (
        <span
          key={i}
          className="w-1 rounded-sm bg-accent/40"
          style={{
            height: `${h * 100}%`,
            animation: reduced ? undefined : `waveform 2.4s ease-in-out ${i * 0.08}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

function TagChips({ summary, reduced }) {
  const match = /(\d+) tag/.exec(summary || "");
  const n = match ? parseInt(match[1], 10) : 0;
  if (!n) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {Array.from({ length: n }).map((_, i) => (
        <span
          key={i}
          className="rounded-full border border-positive/40 px-2 py-0.5 text-label text-positive"
          style={reduced ? undefined : { animation: `fade-up 200ms var(--ease-out) ${i * 80}ms both` }}
        >
          <span className="mr-1">✓</span>tag
        </span>
      ))}
    </div>
  );
}

function scoreColor(score) {
  if (score == null) return "bg-warn";
  if (score >= 70) return "bg-positive";
  if (score >= 40) return "bg-accent";
  return "bg-warn";
}
