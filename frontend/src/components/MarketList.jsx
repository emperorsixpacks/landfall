import React from "react";
import { rankMarkets } from "../lib/globeUtils";

export default function MarketList({ markets, selectedCity, hoveredCity, onSelect, onHover }) {
  const ranked = rankMarkets(markets);
  return (
    <ul className="divide-y divide-border" role="listbox" aria-label="Ranked markets">
      {ranked.map((m) => {
        const active = m.city === selectedCity || m.city === hoveredCity;
        const noData = m.status === "no_data" || m.score == null;
        return (
          <li key={m.city}>
            <button
              role="option"
              aria-selected={m.city === selectedCity}
              onMouseEnter={() => onHover?.(m.city)}
              onMouseLeave={() => onHover?.(null)}
              onFocus={() => onHover?.(m.city)}
              onBlur={() => onHover?.(null)}
              onClick={() => onSelect(m.city)}
              className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${
                active ? "bg-raised" : "hover:bg-raised"
              }`}
            >
              <span className="flex items-center gap-2">
                <span className="num w-5 text-xs text-muted">{m.rank + 1}</span>
                <span className={noData ? "text-muted" : "text-text"}>{m.city}</span>
                {noData && <span className="text-[10px] text-muted">no Qloo data</span>}
              </span>
              <span className="num text-sm text-text">{noData ? "—" : m.score}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
