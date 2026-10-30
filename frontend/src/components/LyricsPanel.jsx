import React, { useState } from "react";
import LyricsLens from "./LyricsLens.jsx";

export default function LyricsPanel({ result, sticky }) {
  const [full, setFull] = useState(false);
  const hasLyrics = result.lyrics && (result.lyrics.segments?.length > 0 || result.lyrics.themes?.length > 0);

  return (
    <div
      id={sticky ? "lyrics-panel" : "lyrics-card"}
      className={`flex flex-col overflow-hidden rounded-xl border border-border bg-panel ${sticky ? "h-full" : ""}`}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">Lyrics</span>
        <button onClick={() => setFull(true)} className="text-small text-accent hover:underline">Full view</button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {hasLyrics ? (
          <LyricsLens lyrics={result.lyrics} audioFeatures={result.audio_features || {}} songId={result.song} panel />
        ) : (
          <p className="text-small text-muted">{result.lyrics?.reason || "Lyrics analysis is off for this run."}</p>
        )}
      </div>

      {full && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onClick={() => setFull(false)}
        >
          <div
            className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-lg border border-border bg-panel p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Lyrics</h2>
              <button onClick={() => setFull(false)} className="text-muted hover:text-text">✕</button>
            </div>
            {hasLyrics ? (
              <LyricsLens lyrics={result.lyrics} audioFeatures={result.audio_features || {}} songId={result.song} />
            ) : (
              <p className="text-small text-muted">{result.lyrics?.reason || "Lyrics analysis is off for this run."}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
