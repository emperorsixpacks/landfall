import React, { useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "../hooks/useMotion";

function fmt(s) {
  if (s == null || isNaN(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function LyricsLens({ lyrics = {}, audioFeatures = {}, songId }) {
  const segments = lyrics.segments || [];
  const tags = lyrics.tags || [];
  const themes = lyrics.themes || [];
  const entities = lyrics.entities || [];
  const energy = audioFeatures.energy_curve || [];
  const sections = audioFeatures.sections || [];
  const hooks = audioFeatures.hooks || [];

  const reduced = useReducedMotion();
  const audioRef = useRef(null);
  const [mode, setMode] = useState("focus");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [loopLine, setLoopLine] = useState(false);
  const [activeTheme, setActiveTheme] = useState(null);
  const [pinned, setPinned] = useState(false);

  const duration = segments.length ? segments[segments.length - 1].end : 0;

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setTime(a.currentTime);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
    };
  }, []);

  // Current line + instrumental gap.
  const activeIndex = useMemo(() => {
    if (!segments.length) return -1;
    let lo = 0, hi = segments.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segments[mid].start <= time) lo = mid;
      else hi = mid - 1;
    }
    return segments[lo].start <= time && time < segments[lo].end ? lo : -1;
  }, [segments, time]);

  const gapUntil = useMemo(() => {
    if (activeIndex !== -1 || !segments.length) return null;
    const next = segments.find((s) => s.start > time);
    return next ? next.start - time : null;
  }, [activeIndex, segments, time]);

  function togglePlay() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play();
    else a.pause();
  }

  function seek(t) {
    const a = audioRef.current;
    if (a) a.currentTime = Math.max(0, t);
  }

  function onLineClick(s) {
    if (loopLine && activeIndex === s.id) {
      setLoopLine(false);
    } else {
      seek(s.start);
    }
  }

  const resolvedThemeNames = new Set(tags.map((t) => t.name.toLowerCase()));

  return (
    <section className="rounded-xl border border-border bg-panel p-5 shadow-soft space-y-3">
      {songId && <audio ref={audioRef} src={`/api/audio/${songId}`} preload="metadata" className="hidden" />}

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Lyrics lens</h2>
          <div className="flex rounded border border-border p-0.5">
            {["focus", "text"].map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`rounded px-2.5 py-0.5 text-small ${mode === m ? "bg-raised text-text" : "text-muted hover:text-text"}`}
              >
                {m === "focus" ? "Focus" : "Text"}
              </button>
            ))}
          </div>
        </div>
        <span className="text-small text-muted">
          {lyrics.language}{lyrics.mood ? ` · ${lyrics.mood}` : ""}
        </span>
      </div>

      {/* Theme chips */}
      {(themes.length > 0 || tags.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {themes.map((theme, i) => {
            const tag = tags.find((t) => t.term.toLowerCase() === theme.toLowerCase());
            const resolved = !!tag;
            return (
              <button
                key={i}
                onMouseEnter={() => !pinned && setActiveTheme(theme)}
                onMouseLeave={() => !pinned && setActiveTheme(null)}
                onClick={() => { setPinned(!pinned); setActiveTheme(pinned ? null : theme); }}
                className={`rounded-pill border px-2.5 py-1 text-small transition-opacity ${
                  resolved ? "border-positive/40 text-positive" : "border-border text-muted"
                }`}
              >
                {resolved ? "✓ " : ""}{tag ? tag.name : theme}
                {!resolved && <span className="text-muted"> · no Qloo match</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* Energy + sections + hooks strip */}
      {(energy.length > 0 || sections.length > 0) && (
        <TimelineStrip energy={energy} sections={sections} hooks={hooks} duration={duration} time={time} onSeek={seek} />
      )}

      {/* FOCUS or TEXT view */}
      {mode === "focus" ? (
        <FocusView
          segments={segments}
          activeIndex={activeIndex}
          gapUntil={gapUntil}
          reduced={reduced}
          onLineClick={onLineClick}
          activeTheme={activeTheme}
          pinned={pinned}
          setPinned={setPinned}
          setActiveTheme={setActiveTheme}
        />
      ) : (
        <TextView segments={segments} reduced={reduced} />
      )}

      {/* Entities */}
      {entities.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {entities.map((e, i) => (
            <span key={i} className="rounded-pill border border-positive/40 px-2.5 py-1 text-small text-positive">
              {e.name} · {e.type}
            </span>
          ))}
        </div>
      )}

      {/* Custom player */}
      <Player
        time={time} duration={duration} playing={playing} speed={speed} loopLine={loopLine}
        onToggle={togglePlay} onSeek={seek} setSpeed={setSpeed} toggleLoop={() => setLoopLine((l) => !l)}
      />

      <p className="text-[11px] text-muted">
        Transcribed from your upload. Only show lyrics for songs you own or that are royalty free. Timestamps are estimated.
      </p>
    </section>
  );
}

function FocusView({ segments, activeIndex, gapUntil, reduced, onLineClick, activeTheme, pinned, setPinned, setActiveTheme }) {
  return (
    <div className="space-y-1 rounded-md bg-raised p-3" role="region" aria-label="Lyrics focus view">
      {segments.map((s, i) => {
        const isActive = i === activeIndex;
        const isNear = Math.abs(i - activeIndex) === 1;
        const isFar = Math.abs(i - activeIndex) === 2;
        const dimmed = activeTheme && pinned && !isActive ? "opacity-35" : "";
        const lowConf = s.conf != null && s.conf < 0.5;
        return (
          <button
            key={s.id}
            onClick={() => onLineClick(s)}
            className={`block w-full rounded px-2 py-1 text-left transition-opacity ${dimmed}`}
          >
            <span
              className={`${
                isActive
                  ? "text-[24px] font-semibold leading-tight text-text"
                  : isNear
                    ? "text-[16px] opacity-40 text-secondary"
                    : isFar
                      ? "text-[14px] opacity-25 text-secondary"
                      : "text-[14px] opacity-25 text-secondary"
              } ${lowConf && !isActive ? "italic opacity-70" : ""}`}
            >
              {s.text}
            </span>
            {lowConf && <span className="text-[10px] text-muted" title="estimated"> · estimated</span>}
          </button>
        );
      })}
      {gapUntil != null && gapUntil > 4 && (
        <div className="flex items-center gap-1.5 py-2 text-muted">
          <span className="num">instrumental {fmt(gapUntil)}</span>
          <span className="flex gap-1">{!reduced && [0, 1, 2].map((i) => <span key={i} className="h-1 w-1 animate-pulse rounded-full bg-muted" style={{ animationDelay: `${i * 150}ms` }} />)}</span>
        </div>
      )}
    </div>
  );
}

function TextView({ segments, reduced }) {
  return (
    <div className="max-h-64 space-y-1 overflow-y-auto rounded-md bg-raised p-3">
      {segments.map((s) => (
        <div key={s.id} className="flex gap-3 text-small">
          <span className="num shrink-0 text-muted">{fmt(s.start)}</span>
          <span className="text-secondary">{s.text}</span>
        </div>
      ))}
    </div>
  );
}

function TimelineStrip({ energy, sections, hooks, duration, time, onSeek }) {
  const W = 100;
  const dur = duration || 1;
  const px = (t) => (t / dur) * W;
  const energyAt = (t) => {
    const i = Math.floor(t / 0.5);
    return energy[i] ?? 0;
  };
  return (
    <div className="space-y-1">
      {/* energy curve */}
      <div className="relative h-8 w-full overflow-hidden rounded bg-raised" onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        onSeek(((e.clientX - rect.left) / rect.width) * dur);
      }}>
        <div className="flex h-full items-end gap-px">
          {energy.map((e, i) => (
            <span key={i} className="w-px bg-accent/50" style={{ height: `${Math.max(4, e * 100)}%` }} />
          ))}
        </div>
        {hooks.map((h, i) => (
          <div key={i} className="absolute bottom-0 top-0 bg-positive/15" style={{ left: `${px(h.start)}%`, width: `${px(h.end) - px(h.start)}%` }} />
        ))}
        <div className="absolute bottom-0 top-0 w-px bg-text" style={{ left: `${px(time)}%` }} />
      </div>
      {/* section strip */}
      <div className="flex h-4 w-full overflow-hidden rounded bg-raised">
        {sections.map((s, i) => (
          <div key={i} className="flex items-center justify-center border-r border-border/50 text-[9px] text-muted" style={{ flex: Math.max(1, s.end - s.start) }} title={`${s.label} (estimated)`}>
            {s.label}
          </div>
        ))}
      </div>
    </div>
  );
}

function Player({ time, duration, playing, speed, loopLine, onToggle, onSeek, setSpeed, toggleLoop }) {
  return (
    <div className="flex items-center gap-3 rounded-md bg-raised px-3 py-2">
      <button onClick={onToggle} className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-black" aria-label={playing ? "Pause" : "Play"}>
        {playing ? "❚❚" : "▶"}
      </button>
      <span className="num w-12 text-muted">{fmt(time)}</span>
      <input
        type="range" min={0} max={duration || 0} step={0.1} value={time}
        onChange={(e) => onSeek(parseFloat(e.target.value))}
        className="h-1 flex-1 accent-[#5B9DFF]"
      />
      <span className="num w-12 text-muted">{fmt(duration)}</span>
      <select value={speed} onChange={(e) => setSpeed(parseFloat(e.target.value))} className="rounded bg-panel border border-border text-small text-muted">
        {[0.75, 1, 1.25].map((s) => <option key={s} value={s}>{s}x</option>)}
      </select>
      <button onClick={toggleLoop} className={`rounded border px-2 py-0.5 text-small ${loopLine ? "border-accent text-accent" : "border-border text-muted"}`}>
        loop
      </button>
    </div>
  );
}
