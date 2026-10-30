import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../lib/globeUtils", () => ({
  webglAvailable: () => false,
  rankMarkets: (m) => m.map((x, i) => ({ ...x, rank: i })),
  scoreToColor: () => "#5B9DFF",
  hasVenueCoordinates: () => false,
  joinMarketsToCountries: (m) => m,
  COLORS: { base: "#15171C", land: "#262A33", low: "#3A404B", high: "#5B9DFF", top: "#4CC38A", noData: "#5A616D" },
}));

import GlobeContainer from "../GlobeContainer.jsx";

describe("GlobeContainer fallback", () => {
  it("renders the SVG fallback when WebGL is unavailable", () => {
    const { container } = render(
      <GlobeContainer
        markets={[{ country: "Nigeria", lat: 6.5, lng: 3.3, score: 90, status: "scored", venues: [] }]}
        origin={null}
      />
    );
    expect(screen.getByText(/flat dot-map/i)).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeTruthy();
  });
});
