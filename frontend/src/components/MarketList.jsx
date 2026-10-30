import React, { useMemo, useState } from "react";
import { rankMarkets } from "../lib/globeUtils";
import AskButton from "./AskButton.jsx";

export default function MarketList({ markets = [], selectedCity, hoveredCity, onSelect, onHover }) {
  const [search, setSearch] = useState("");
  const ranked = useMemo(() => rankMarkets(markets), [markets]);

  const filtered = useMemo(() => {
    if (!search.trim()) return ranked;
    const q = search.toLowerCase();
    return ranked.filter(
      (m) => m.city.toLowerCase().includes(q) || (m.country && m.country.toLowerCase().includes(q))
    );
  }, [ranked, search]);

  return (
    <div className="flex flex-col h-full bg-panel">
      {/* Search Header */}
      <div className="p-2.5 border-b border-border flex items-center justify-between gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter markets..."
          className="w-full rounded border border-border bg-raised px-2.5 py-1 text-xs text-text placeholder-muted/60 outline-none focus:border-accent"
        />
        <span className="text-[10px] num text-muted shrink-0">{filtered.length} cities</span>
      </div>

      {/* List */}
      <ul className="flex-1 overflow-y-auto divide-y divide-border/60" role="listbox" aria-label="Ranked markets">
        {filtered.map((m) => {
          const isSelected = m.city === selectedCity;
          const isHovered = m.city === hoveredCity;
          const noData = m.status === "no_data" || m.score == null;

          return (
            <li key={m.city} className="grid grid-cols-[1fr_28px] items-center gap-1">
              <button
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => onHover?.(m.city)}
                onMouseLeave={() => onHover?.(null)}
                onFocus={() => onHover?.(m.city)}
                onBlur={() => onHover?.(null)}
                onClick={() => onSelect(m.city)}
                className={`grid grid-cols-[24px_minmax(0,1fr)_80px_56px] items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                  isSelected
                    ? "bg-raised border-l-2 border-accent"
                    : isHovered
                    ? "bg-raised"
                    : "hover:bg-raised/70"
                }`}
              >
                <span className="num text-xs text-muted">{m.rank + 1}</span>
                <div className="min-w-0 truncate">
                  <span className={noData ? "text-muted" : "text-text"}>{m.city}</span>
                  {m.country && (
                    <span className="ml-1 text-[11px] text-muted/60 truncate">({m.country})</span>
                  )}
                  {noData && <span className="ml-1 text-[10px] text-muted">no data</span>}
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-raised">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${noData ? 0 : Math.min(100, m.score)}%` }}
                  />
                </div>
                <span className="num text-right text-sm text-text">{noData ? "—" : m.score}</span>
              </button>
              <AskButton
                className="flex h-7 w-7 items-center justify-center rounded border border-border text-[10px] text-muted hover:border-accent hover:text-text"
                context={{ type: "market", id: m.city, label: m.city }}
                question={noData ? `Why is there no data for ${m.city}?` : `Why is ${m.city} ranked #${m.rank + 1}?`}
              />
            </li>
          );
        })}

        {filtered.length === 0 && (
          <li className="p-6 text-center text-xs text-muted">No markets found.</li>
        )}
      </ul>
    </div>
  );
}
