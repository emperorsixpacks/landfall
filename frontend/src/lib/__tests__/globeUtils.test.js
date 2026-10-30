import { describe, it, expect, vi } from "vitest";
import {
  COLORS,
  hasVenueCoordinates,
  formatKey,
  formatTime,
  generateReleaseStrategyMarkdown,
  getRegion,
  interpolateColor,
  joinMarketsToCountries,
  rankMarkets,
  sanitizeLandFeatures,
  scoreToColor,
} from "../globeUtils";

const COUNTRIES = [
  { country: "Nigeria", lat: 6.5, lng: 3.3 },
  { country: "United Kingdom", lat: 51.5, lng: -0.1 },
];

describe("joinMarketsToCountries", () => {
  it("joins known countries with lat/lng", () => {
    const out = joinMarketsToCountries(
      [{ country: "Nigeria", score: 90 }, { country: "United Kingdom", score: 80 }],
      COUNTRIES
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ country: "Nigeria", lat: 6.5, lng: 3.3 });
  });

  it("warns and skips unknown countries", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = joinMarketsToCountries([{ country: "Atlantis", score: 10 }], COUNTRIES);
    expect(out).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("scoreToColor", () => {
  it("returns the top color for the top 3", () => {
    expect(scoreToColor(50, 0)).toBe(COLORS.top);
    expect(scoreToColor(50, 2)).toBe(COLORS.top);
  });
  it("interpolates low → high for the rest", () => {
    expect(scoreToColor(0, 5)).toBe(COLORS.low);
    expect(scoreToColor(100, 5)).toBe(COLORS.high);
  });
});

describe("interpolateColor", () => {
  it("returns endpoints at 0 and 1", () => {
    expect(interpolateColor("#000000", "#ffffff", 0)).toBe("#000000");
    expect(interpolateColor("#000000", "#ffffff", 1)).toBe("#FFFFFF");
  });
});

describe("rankMarkets", () => {
  it("orders scored desc then no_data last, assigning rank", () => {
    const markets = [
      { country: "X", score: null, status: "no_data" },
      { country: "A", score: 90, status: "scored" },
      { country: "B", score: 70, status: "scored" },
    ];
    const r = rankMarkets(markets);
    expect(r.map((m) => m.country)).toEqual(["A", "B", "X"]);
    expect(r[0].rank).toBe(0);
    expect(r[2].rank).toBe(2);
  });
});

describe("hasVenueCoordinates", () => {
  it("detects any venue and empty venues", () => {
    expect(hasVenueCoordinates([{ country: "A", venues: [] }, { country: "B", venues: [{ name: "x" }] }])).toBe(true);
    expect(hasVenueCoordinates([{ country: "A", venues: [] }])).toBe(false);
  });
});

describe("sanitizeLandFeatures", () => {
  it("removes degenerate polygons that have fewer than 3 distinct points", () => {
    const degenerateRing = [
      [130.0, 42.0],
      [130.0, 42.0],
      [130.0, 42.0],
      [130.0, 42.0],
    ];
    const validRing = [
      [0.0, 0.0],
      [1.0, 0.0],
      [1.0, 1.0],
      [0.0, 0.0],
    ];
    const features = [
      {
        type: "Feature",
        properties: { name: "DegenerateCountry" },
        geometry: {
          type: "Polygon",
          coordinates: [degenerateRing],
        },
      },
      {
        type: "Feature",
        properties: { name: "MultiCountry" },
        geometry: {
          type: "MultiPolygon",
          coordinates: [
            [degenerateRing],
            [validRing],
          ],
        },
      },
    ];

    const cleaned = sanitizeLandFeatures(features);
    // DegenerateCountry has no valid polygons left -> removed
    expect(cleaned.find((f) => f.properties.name === "DegenerateCountry")).toBeUndefined();
    // MultiCountry has the degenerate sub-polygon removed and valid sub-polygon preserved
    const multi = cleaned.find((f) => f.properties.name === "MultiCountry");
    expect(multi).toBeDefined();
    expect(multi.geometry.coordinates).toHaveLength(1);
    expect(multi.geometry.coordinates[0]).toEqual([validRing]);
  });
});

describe("formatTime & formatKey", () => {
  it("formats seconds to m:ss cleanly", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(34.2)).toBe("0:34");
    expect(formatTime(75)).toBe("1:15");
    expect(formatTime(null)).toBe("0:00");
  });

  it("formats key and mode cleanly", () => {
    expect(formatKey("C", "major")).toBe("C Major");
    expect(formatKey("F#", "minor")).toBe("F# Minor");
    expect(formatKey(null)).toBe("Unknown Key");
  });
});

describe("getRegion", () => {
  it("maps countries to global regions", () => {
    expect(getRegion("Nigeria")).toBe("Africa");
    expect(getRegion("United Kingdom")).toBe("Europe");
    expect(getRegion("United States")).toBe("North America");
    expect(getRegion("UnknownLand")).toBe("Other");
  });
});

describe("generateReleaseStrategyMarkdown", () => {
  it("generates markdown document with all key sections", () => {
    const result = {
      artist: "Tems",
      song: "track123",
      fit_score: 88,
      breakdown: { catalog_match: 90, audience_match: 85 },
      clip_strength: 92,
      audio_features: { tempo: 104, key: "F", mode: "minor", loudness_lufs: -14.2 },
      markets: [{ country: "Lagos", score: 95, status: "scored" }],
      clips: [{ start: 30, end: 50, caption: "Catchy hook" }],
      blurb: "High energy Afro-soul release.",
      collaborators: [{ name: "Wizkid", why: "Strong audience overlap" }],
    };
    const md = generateReleaseStrategyMarkdown(result);
    expect(md).toContain("# Landfall Release Strategy: Tems");
    expect(md).toContain("104 BPM");
    expect(md).toContain("F Minor");
    expect(md).toContain("Lagos");
    expect(md).toContain("Catchy hook");
    expect(md).toContain("Wizkid");
  });
});
