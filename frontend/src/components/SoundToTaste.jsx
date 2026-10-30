import React, { useState } from "react";
import AskButton from "./AskButton.jsx";

function fmt(v) {
  if (v == null) return "—";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return String(v);
}

const FEATURE_LABELS = {
  tempo: "Tempo",
  mode: "Key mode",
  "energy.peak": "Energy peak",
  "energy.mean": "Energy",
  "brightness.high": "Brightness",
  onset_density_per_sec: "Rhythmic density",
};

const USE_LABELS = {
  venues: "Live venue search",
  comparables: "Comparable matching",
  markets: "Market ranking",
  captions: "Caption writing",
};

export default function SoundToTaste({ bridge }) {
  const trace = bridge?.trace || [];
  const [hover, setHover] = useState(null);

  const used = trace.filter((t) => !!t.qloo_tag_id);
  const unused = trace.filter((t) => !t.qloo_tag_id);

  if (!trace.length) {
    return <p className="text-sm text-muted">No sound-to-taste mapping — upload a song to bridge audio to Qloo tags.</p>;
  }

  return (
    <div>
      {used.length > 0 && (
        <>
          <div className="grid grid-cols-[1.4fr_1fr_1.4fr] gap-3 text-[10px] uppercase tracking-wide text-muted">
            <span>Sound</span>
            <span>Taste tags</span>
            <span>Result</span>
          </div>
          <div className="mt-1 divide-y divide-border">
            {used.map((t, i) => {
              const active = hover === i;
              const uses = (t.used_in || []).map((u) => USE_LABELS[u] || u).filter(Boolean);
              return (
                <div
                  key={i}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  className={`grid grid-cols-[1.4fr_1fr_1.4fr] items-center gap-3 py-2 text-xs transition-colors ${active ? "bg-raised" : ""}`}
                >
                  <div className="min-w-0">
                    <span className="font-mono text-text">{FEATURE_LABELS[t.feature] || t.feature}</span>
                    <span className="ml-2 font-mono text-muted">{fmt(t.value)}</span>
                  </div>
                  <div className="min-w-0">
                    <span className="inline-block truncate rounded-full border border-border px-2 py-0.5 text-muted">
                      {t.qloo_tag_name}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-text">
                    <span className="truncate">{uses.length ? uses.join(", ") : "not used"}</span>
                    <AskButton
                      context={{ type: "sound", id: t.feature, label: t.qloo_tag_name || (FEATURE_LABELS[t.feature] || t.feature) }}
                      question={`What does the ${FEATURE_LABELS[t.feature] || t.feature} → ${t.qloo_tag_name || "tag"} match mean?`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {unused.length > 0 && (
        <p className="mt-2 text-small text-muted">
          {unused.length} signal{unused.length === 1 ? "" : "s"} not used: {unused.map((t) => FEATURE_LABELS[t.feature] || t.feature).join(", ")}
        </p>
      )}

      {used.length === 0 && (
        <p className="text-sm text-muted">No sound-to-taste signals resolved to Qloo tags.</p>
      )}
    </div>
  );
}
