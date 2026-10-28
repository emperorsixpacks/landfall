// Pure helpers for the globe visualization. No three.js / DOM imports here so
// these are trivially unit-testable in Node.

export const COLORS = {
  low: "#4A5568", // muted slate (lower scores)
  mid: "#5B9DFF", // accent (mid scores)
  high: "#4CC38A", // positive (high scores)
  top: "#4CC38A", // positive (top 3)
  noData: "#5A616D",
  land: "#2E3642", // land — brighter than base for visibility
  base: "#0E0F12", // ocean/base — dark
  arc: "#5B9DFF",
  atmosphere: "#5B9DFF",
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
  // Top 3 get the positive color; otherwise interpolate low → mid → high.
  if (typeof rank === "number" && rank < 3) return COLORS.top;
  const s = clamp(score ?? 0, 0, 100) / 100;
  // Use a curve for better visual distribution
  if (s < 0.5) {
    return interpolateColor(COLORS.low, COLORS.mid, s * 2);
  } else {
    return interpolateColor(COLORS.mid, COLORS.high, (s - 0.5) * 2);
  }
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
    const gl =
      window.WebGLRenderingContext &&
      (c.getContext("webgl") || c.getContext("experimental-webgl"));
    if (!gl) return false;
    // Some environments (VMs, headless) create a context but fail to compile
    // shaders at render time. Verify a trivial program compiles first.
    const vs = gl.createShader(gl.VERTEX_SHADER);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    if (!vs || !fs) return false;
    gl.shaderSource(vs, "attribute vec3 p; void main(){ gl_Position = vec4(p, 1.0); }");
    gl.shaderSource(fs, "void main(){ gl_FragColor = vec4(1.0); }");
    gl.compileShader(vs);
    gl.compileShader(fs);
    return (
      gl.getShaderParameter(vs, gl.COMPILE_STATUS) &&
      gl.getShaderParameter(fs, gl.COMPILE_STATUS)
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

/**
 * Filter out degenerate polygon rings (e.g. zero-area polygons with identical vertices)
 * that cause H3's polygonToCells indexing to fail with code 1.
 */
export function sanitizeLandFeatures(features) {
  if (!Array.isArray(features)) return [];

  const isRingValid = (ring) => {
    if (!Array.isArray(ring) || ring.length < 4) return false;
    const unique = new Set();
    for (const pt of ring) {
      if (!Array.isArray(pt) || pt.length < 2) return false;
      unique.add(`${pt[0]},${pt[1]}`);
      if (unique.size >= 3) break;
    }
    return unique.size >= 3;
  };

  const isPolygonValid = (poly) => {
    if (!Array.isArray(poly) || poly.length === 0) return false;
    return isRingValid(poly[0]);
  };

  const sanitized = [];
  for (const f of features) {
    if (!f || !f.geometry) continue;
    const { type, coordinates } = f.geometry;

    if (type === "Polygon") {
      if (isPolygonValid(coordinates)) {
        sanitized.push(f);
      }
    } else if (type === "MultiPolygon") {
      if (Array.isArray(coordinates)) {
        const validPolys = coordinates.filter(isPolygonValid);
        if (validPolys.length > 0) {
          sanitized.push({
            ...f,
            geometry: {
              ...f.geometry,
              coordinates: validPolys,
            },
          });
        }
      }
    } else {
      sanitized.push(f);
    }
  }

  return sanitized;
}

export function formatTime(seconds) {
  if (typeof seconds !== "number" || isNaN(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatKey(key, mode) {
  if (!key) return "Unknown Key";
  const m = mode ? mode.charAt(0).toUpperCase() + mode.slice(1).toLowerCase() : "";
  return `${key} ${m}`.trim();
}

const REGION_MAP = {
  Nigeria: "Africa",
  Ghana: "Africa",
  Kenya: "Africa",
  "South Africa": "Africa",
  Egypt: "Africa",
  Morocco: "Africa",
  Senegal: "Africa",
  "Côte d'Ivoire": "Africa",
  Uganda: "Africa",
  Tanzania: "Africa",
  Rwanda: "Africa",
  Angola: "Africa",
  "DR Congo": "Africa",
  Cameroon: "Africa",
  Algeria: "Africa",
  Tunisia: "Africa",
  Ethiopia: "Africa",

  "United Kingdom": "Europe",
  France: "Europe",
  Germany: "Europe",
  Netherlands: "Europe",
  Spain: "Europe",
  Italy: "Europe",
  Portugal: "Europe",
  Sweden: "Europe",
  Norway: "Europe",
  Denmark: "Europe",
  Switzerland: "Europe",
  Belgium: "Europe",
  Ireland: "Europe",
  Austria: "Europe",
  Poland: "Europe",

  "United States": "North America",
  Canada: "North America",
  Mexico: "North America",

  Brazil: "Latin America",
  Argentina: "Latin America",
  Colombia: "Latin America",
  Chile: "Latin America",

  Japan: "Asia/Pacific",
  "South Korea": "Asia/Pacific",
  Australia: "Asia/Pacific",
  "New Zealand": "Asia/Pacific",
  India: "Asia/Pacific",
  Indonesia: "Asia/Pacific",
  Philippines: "Asia/Pacific",
  Singapore: "Asia/Pacific",
  Thailand: "Asia/Pacific",

  UAE: "Middle East",
  "United Arab Emirates": "Middle East",
  "Saudi Arabia": "Middle East",
  Qatar: "Middle East",
  Lebanon: "Middle East",
};

export function getCityRegion(country) {
  if (!country) return "Other";
  return REGION_MAP[country] || "Other";
}

export function generateReleaseStrategyMarkdown(result) {
  if (!result) return "";
  const date = new Date().toISOString().split("T")[0];
  const audio = result.audio_features || {};

  let md = `# Landfall Release Strategy: ${result.artist || "Artist"}\n\n`;
  md += `**Date:** ${date}  \n`;
  md += `**Track ID:** ${result.song || "Unreleased"}  \n`;
  if (result.origin?.city) {
    md += `**Artist Origin:** ${result.origin.city}${result.origin.country ? `, ${result.origin.country}` : ""}  \n`;
  }
  md += `**Predicted Fit Score:** ${result.fit_score ?? "N/A"}/100  \n\n`;

  md += `## 1. Fit & Acoustic Breakdown\n\n`;
  md += `* ${result.explanation || "No explanation provided."}\n\n`;
  if (result.breakdown) {
    md += `| Dimension | Score | Description |\n`;
    md += `|---|---|---|\n`;
    md += `| Catalog Match | ${Math.round(result.breakdown.catalog_match ?? 0)}% | Overlap of comparable artist tags with core catalog |\n`;
    md += `| Audience Match | ${Math.round(result.breakdown.audience_match ?? 0)}% | Qloo taste graph affinity ranking across listener entities |\n`;
    md += `| Clip Strength | ${Math.round(result.clip_strength ?? 0)}% | Peak musical energy & novelty in hook windows |\n\n`;
  }

  if (audio.tempo || audio.key) {
    md += `### Acoustic Features\n\n`;
    md += `- **Tempo:** ${audio.tempo ? `${Math.round(audio.tempo)} BPM` : "N/A"} (${result.tempo_band || "Standard"})\n`;
    md += `- **Key & Mode:** ${formatKey(audio.key, audio.mode)} ${audio.key_confidence ? `(confidence: ${Math.round(audio.key_confidence * 100)}%)` : ""}\n`;
    md += `- **Loudness:** ${audio.loudness_lufs ? `${audio.loudness_lufs} LUFS` : "N/A"}\n`;
    md += `- **Energy:** ${result.energy_band || "Moderate"}\n`;
    if (result.descriptors?.length) {
      md += `- **Sound Descriptors:** ${result.descriptors.join(", ")}\n`;
    }
    md += `\n`;
  }

  md += `## 2. Priority Target Markets\n\n`;
  const ranked = rankMarkets(result.markets || []);
  const scoredMarkets = ranked.filter((m) => m.status !== "no_data" && m.score != null);
  if (scoredMarkets.length) {
    md += `| Rank | City | Score | Geographic Insights |\n`;
    md += `|---|---|---|---|\n`;
    scoredMarkets.forEach((m, idx) => {
      md += `| ${idx + 1} | ${m.city} | ${m.score} | ${m.reason || "High affinity overperformance"} |\n`;
    });
    md += `\n`;
  } else {
    md += `No geographic markets scored with active affinity.\n\n`;
  }

  if (result.clips?.length) {
    md += `## 3. Recommended Hook Clips\n\n`;
    result.clips.forEach((c, idx) => {
      md += `### Hook ${idx + 1} (${formatTime(c.start)} – ${formatTime(c.end)})\n`;
      md += `* **Caption:** "${c.caption || ""}"\n`;
      if (c.audio_url) md += `* **Audio Link:** ${c.audio_url}\n`;
      md += `\n`;
    });
  }

  if (result.blurb) {
    md += `## 4. Pitch Blurb (DSP & Press)\n\n`;
    md += `> ${result.blurb}\n\n`;
  }

  if (result.collaborators?.length) {
    md += `## 5. Potential Collaborators\n\n`;
    result.collaborators.forEach((c) => {
      md += `* **${c.name}:** ${c.why || "High audience overlap"}\n`;
    });
    md += `\n`;
  }

  md += `---\n*Generated by Landfall Agentic Release Planner via Qloo Taste Intelligence.*\n`;
  return md;
}
