import React, { useState } from "react";

function fmt(v) {
  if (v == null) return "—";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return String(v);
}

export default function SoundToTaste({ bridge }) {
  const trace = bridge?.trace || [];
  const [hover, setHover] = useState(null);

  if (!trace.length) {
    return <p className="text-sm text-muted">No sound-to-taste mapping — upload a song to bridge audio to Qloo tags.</p>;
  }

  return (
    <div>
      <div className="grid grid-cols-3 gap-3 text-[10px] uppercase tracking-wide text-muted">
        <span>Sound</span>
        <span>Taste tags</span>
        <span>Qloo results</span>
      </div>
      <div className="mt-1 divide-y divide-border">
        {trace.map((t, i) => {
          const active = hover === i;
          const resolved = !!t.qloo_tag_id;
          return (
            <div
              key={i}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              className={`grid grid-cols-3 items-center gap-3 py-2 text-xs transition-colors ${
                active ? "bg-raised" : ""
              }`}
            >
              <div>
                <span className="font-mono text-text">{t.feature}</span>
                <span className="ml-2 font-mono text-muted">{fmt(t.value)}</span>
              </div>
              <div>
                {resolved ? (
                  <span className={`inline-block rounded-full border px-2 py-0.5 ${active ? "border-accent text-text" : "border-border text-muted"}`}>
                    {t.qloo_tag_name}
                  </span>
                ) : (
                  <span className="text-muted">unresolved</span>
                )}
              </div>
              <div className={resolved ? "text-text" : "text-muted"}>
                {resolved ? (t.used_in?.length ? t.used_in.join(", ") : "no downstream use") : "dropped"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
