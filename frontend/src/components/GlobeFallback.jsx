import React from "react";
import { COLORS, rankMarkets, scoreToColor } from "../lib/globeUtils";

const W = 1000;
const H = 500;

function project(lat, lng) {
  return [(lng + 180) / 360 * W, (90 - lat) / 180 * H];
}

export default function GlobeFallback({ markets = [], origin = null }) {
  const ranked = rankMarkets(markets);
  const top5 = ranked.filter((m) => m.status !== "no_data" && m.score != null).slice(0, 5);
  const originXY = origin ? project(origin.lat, origin.lng) : null;

  return (
    <div className="relative h-full w-full overflow-hidden rounded-md border border-border bg-panel">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" preserveAspectRatio="xMidYMid meet">
        <rect width={W} height={H} fill={COLORS.base} />
        {originXY &&
          top5.map((m) => {
            const [x2, y2] = project(m.lat, m.lng);
            return (
              <line
                key={m.country}
                x1={originXY[0]} y1={originXY[1]} x2={x2} y2={y2}
                stroke={scoreToColor(m.score)} strokeWidth={1} strokeOpacity={0.6} strokeDasharray="4 3"
              />
            );
          })}
        {ranked.map((m) => {
          const [x, y] = project(m.lat, m.lng);
          const isNoData = m.status === "no_data" || m.score == null;
          if (isNoData) {
            return (
              <circle key={m.country} cx={x} cy={y} r={4} fill="none" stroke={COLORS.noData} strokeWidth={1.5} />
            );
          }
          return (
            <circle key={m.country} cx={x} cy={y} r={4 + (m.score ?? 0) / 100 * 7} fill={scoreToColor(m.score, m.rank)} />
          );
        })}
        {originXY && (
          <circle cx={originXY[0]} cy={originXY[1]} r={5} fill="#E8EAED" />
        )}
      </svg>
      <p className="absolute bottom-1 right-2 text-[10px] text-muted">flat dot-map (WebGL unavailable)</p>
    </div>
  );
}
