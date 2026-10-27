import { describe, it, expect, vi } from "vitest";
import {
  COLORS,
  hasVenueCoordinates,
  interpolateColor,
  joinMarketsToCities,
  rankMarkets,
  scoreToColor,
} from "../globeUtils";

const CITIES = [
  { city: "Lagos", country: "Nigeria", lat: 6.5, lng: 3.3 },
  { city: "London", country: "United Kingdom", lat: 51.5, lng: -0.1 },
];

describe("joinMarketsToCities", () => {
  it("joins known cities with lat/lng/country", () => {
    const out = joinMarketsToCities(
      [{ city: "Lagos", score: 90 }, { city: "London", score: 80 }],
      CITIES
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ city: "Lagos", lat: 6.5, lng: 3.3, country: "Nigeria" });
  });

  it("warns and skips unknown cities", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = joinMarketsToCities([{ city: "Atlantis", score: 10 }], CITIES);
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
      { city: "X", score: null, status: "no_data" },
      { city: "A", score: 90, status: "scored" },
      { city: "B", score: 70, status: "scored" },
    ];
    const r = rankMarkets(markets);
    expect(r.map((m) => m.city)).toEqual(["A", "B", "X"]);
    expect(r[0].rank).toBe(0);
    expect(r[2].rank).toBe(2);
  });
});

describe("hasVenueCoordinates", () => {
  it("detects any venue and empty venues", () => {
    expect(hasVenueCoordinates([{ city: "A", venues: [] }, { city: "B", venues: [{ name: "x" }] }])).toBe(true);
    expect(hasVenueCoordinates([{ city: "A", venues: [] }])).toBe(false);
  });
});
