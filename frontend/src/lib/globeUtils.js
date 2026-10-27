// Pure helpers for the globe visualization. No three.js / DOM imports here so
// these are trivially unit-testable in Node.

export const COLORS = {
  low: "#3A404B", // muted gray-blue
  high: "#5B9DFF", // accent
  top: "#4CC38A", // positive
  noData: "#5A616D",
  land: "#262A33",
  base: "#15171C",
};

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r, g, b) {
  const to = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}

export function interpolateColor(hexA, hexB, t) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const t2 = clamp(t, 0, 1);
  return rgbToHex(
    a[0] + (b[0] - a[0]) * t2,
    a[1] + (b[1] - a[1]) * t2,
    a[2] + (b[2] - a[2]) * t2
  );
}

export function scoreToColor(score, rank) {
  // Top 3 get the positive color; otherwise interpolate low → high.
  if (typeof rank === "number" && rank < 3) return COLORS.top;
  const s = clamp(score ?? 0, 0, 100) / 100;
  return interpolateColor(COLORS.low, COLORS.high, s);
}

export function joinMarketsToCities(markets, cities) {
  const byName = new Map(cities.map((c) => [c.city.toLowerCase(), c]));
  const joined = [];
  for (const m of markets || []) {
    const c = byName.get(String(m.city || "").toLowerCase());
    if (!c) {
      console.warn("unknown city, skipping:", m.city);
      continue;
    }
    joined.push({ ...m, lat: c.lat, lng: c.lng, country: c.country });
  }
  return joined;
}

// Rank markets: scored first (descending), then no_data (score null) last.
export function rankMarkets(markets) {
  const scored = markets
    .filter((m) => m.status !== "no_data" && m.score != null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const noData = markets.filter((m) => m.status === "no_data" || m.score == null);
  return [...scored, ...noData].map((m, i) => ({ ...m, rank: i }));
}

export function webglAvailable() {
  if (typeof window === "undefined") return false;
  try {
    const c = document.createElement("canvas");
    return !!(
      window.WebGLRenderingContext &&
      (c.getContext("webgl") || c.getContext("experimental-webgl"))
    );
  } catch {
    return false;
  }
}

export function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function hasVenueCoordinates(markets) {
  return (markets || []).some((m) => Array.isArray(m.venues) && m.venues.length > 0);
}
