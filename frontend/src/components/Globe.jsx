import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import Globe from "react-globe.gl";
import { MeshLambertMaterial } from "three";
import { feature } from "topojson-client";
import countries from "world-atlas/countries-110m.json";
import {
  COLORS,
  prefersReducedMotion,
  rankMarkets,
  sanitizeLandFeatures,
  scoreToColor,
} from "../lib/globeUtils";

const LAND = sanitizeLandFeatures(
  feature(countries, countries.objects.countries).features
);

// world-atlas name -> our country name (a few naming differences).
const WA_TO_MINE = {
  "dem. rep. congo": "dr congo",
  "united states of america": "united states",
};
const NO_DATA_COLOR = "#262E38";

// forwardRef exposes: flyToCity(m), resetView(), saveImage(), startTour()
const LandfallGlobe = forwardRef(function LandfallGlobe(
  {
    markets = [],
    origin = null,
    selectedCity = null,
    hoveredCity = null,
    onSelect,
    onHover,
    showMarkets = true,
    showArcs = true,
    showVenues = true,
    interactive = true,
    height = 460,
    allCities = [],
  },
  ref
) {
  const globeEl = useRef(null);
  const wrapRef = useRef(null);
  const dimsState = useState({ width: 800, height: Math.max(height, 480) });
  const [dims, setDims] = dimsState;
  const globeMaterial = useMemo(
    () => new MeshLambertMaterial({ color: COLORS.base }),
    []
  );

  // Size the canvas to its container, min height 420.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setDims({ width: r.width, height: Math.max(r.height, 480) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const ranked = rankMarkets(markets);
  const top3 = ranked.filter((m) => m.status !== "no_data" && m.score != null).slice(0, 3);
  const top5 = ranked.filter((m) => m.status !== "no_data" && m.score != null).slice(0, 5);

  const fitView = useMemo(() => {
    const pts = ranked.filter((m) => m.status !== "no_data" && m.lat != null);
    if (!pts.length) return { lat: 15, lng: 0, altitude: 2.5 };
    const lat = pts.reduce((s, m) => s + m.lat, 0) / pts.length;
    const lng = pts.reduce((s, m) => s + m.lng, 0) / pts.length;
    return { lat, lng, altitude: 1.6 };
  }, [ranked]);

  // Country name (ours) -> market, for the choropleth fill + interaction.
  const nameToScore = useMemo(() => {
    const map = new Map();
    for (const m of ranked) {
      if (m.score != null) map.set((m.city || "").toLowerCase().trim(), m);
    }
    return map;
  }, [ranked]);

  const featureToMarket = (f) => {
    const wa = (f?.properties?.name || "").toLowerCase().trim();
    const key = WA_TO_MINE[wa] || wa;
    return nameToScore.get(key) || null;
  };

  const polygonColor = (f) => {
    if (!showMarkets) return COLORS.land;
    const m = featureToMarket(f);
    return m ? scoreToColor(m.score, m.rank) : NO_DATA_COLOR;
  };

  const reduced = prefersReducedMotion();

  // Auto-rotate until first interaction.
  useEffect(() => {
    const g = globeEl.current;
    if (!g || !interactive) return;
    const controls = g.controls?.();
    if (!controls) return;
    if (reduced) {
      controls.autoRotate = false;
      return;
    }
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.4;
    return () => {
      controls.autoRotate = false;
    };
  }, [reduced, interactive]);

  // Guided tour of top 3 on first load, cancelled by any interaction.
  useEffect(() => {
    if (!interactive || reduced || top3.length === 0) return;
    const g = globeEl.current;
    if (!g) return;
    let cancelled = false;
    const cancel = () => (cancelled = true);
    const el = g.renderer?.()?.domElement;
    if (!el) return;
    el.addEventListener("pointerdown", cancel);
    el.addEventListener("wheel", cancel);
    const tour = async () => {
      await new Promise((r) => setTimeout(r, 900));
      for (const m of top3) {
        if (cancelled) break;
        g.pointOfView({ lat: m.lat, lng: m.lng, altitude: 1.2 }, 1200);
        await new Promise((r) => setTimeout(r, 2500));
      }
      if (!cancelled) g.pointOfView(fitView, 1200);
    };
    tour();
    return () => {
      cancelled = true;
      el.removeEventListener("pointerdown", cancel);
      el.removeEventListener("wheel", cancel);
    };
  }, [interactive, reduced, top3.length]);

  useImperativeHandle(ref, () => ({
    flyToCity(m) {
      const g = globeEl.current;
      if (g && m && m.lat != null && m.lng != null) {
        g.pointOfView({ lat: m.lat, lng: m.lng, altitude: 0.55 }, 800);
      }
    },
    resetView() {
      const g = globeEl.current;
      if (g) g.pointOfView(fitView, 800);
    },
    saveImage() {
      const g = globeEl.current;
      if (g) return g.renderer().domElement.toDataURL("image/png");
      return null;
    },
    startTour() {
      const g = globeEl.current;
      if (!g) return;
      g.pointOfView(fitView, 1000);
    },
  }));

  const arcsData =
    showArcs && origin && top5.length
      ? top5.map((m) => ({
          startLat: origin.lat,
          startLng: origin.lng,
          endLat: m.lat,
          endLng: m.lng,
          score: m.score,
        }))
      : [];

  const ringsData = [];
  if (selectedCity) {
    const m = ranked.find((r) => r.city === selectedCity)
      || allCities.find((c) => c.city === selectedCity);
    if (m && m.lat != null) ringsData.push({ ...m, isSelected: true });
  }

  const venues = showVenues
    ? ranked.flatMap((m) => (m.venues || []).map((v) => ({ ...v, market: m.city })))
    : [];

  return (
    <div ref={wrapRef} className="h-full w-full" style={{ minHeight: 480 }}>
      <Globe
        ref={globeEl}
        width={dims.width}
        height={dims.height}
        backgroundColor="rgba(255,255,255,0)"
        globeMaterial={globeMaterial}
        atmosphereColor={COLORS.atmosphere}
        atmosphereAltitude={0.12}
        polygonsData={LAND}
        polygonCapColor={polygonColor}
        polygonSideColor={() => "#151A20"}
        polygonStrokeColor={() => "#0E1216"}
        polygonAltitude={0.012}
        polygonCapCurvatureResolution={2}
        polygonLabel={(f) => {
          const m = featureToMarket(f);
          if (!m) return `<div class="globe-tip"><b>${f?.properties?.name || ""}</b><span>no data</span></div>`;
          return `<div class="globe-tip"><b>${m.city}</b><span class="num">${m.score}</span><small>${m.reason || ""}</small></div>`;
        }}
        onPolygonHover={(f) => onHover && onHover(f ? (featureToMarket(f)?.city || null) : null)}
        onPolygonClick={(f) => {
          if (!f) return;
          const m = featureToMarket(f);
          if (m && onSelect) onSelect(m.city);
        }}
        arcsData={arcsData}
        arcColor={(d) => scoreToColor(d.score)}
        arcStroke={(d) => 0.35 + (d.score ?? 0) / 100 * 1.1}
        arcDashLength={0.5}
        arcDashGap={reduced ? 0 : 0.25}
        arcDashAnimateTime={reduced ? 0 : 2600}
        arcAltitudeAutoScale={0.3}
        labelsData={showMarkets ? top3 : []}
        labelLat={(d) => d.lat}
        labelLng={(d) => d.lng}
        labelText={(d) => d.city}
        labelLabel={(d) =>
          `<div style="font-family:Inter,system-ui,sans-serif;font-size:13px;color:#1A1F36;background:rgba(255,255,255,0.98);padding:6px 10px;border-radius:8px;border:1px solid #E1E4E8;backdrop-filter:blur(12px);box-shadow:0 4px 16px rgba(0,0,0,0.1);">${d.city} <span style="font-family:'JetBrains Mono',monospace;color:#48BB78;font-weight:600;">${d.score}</span></div>`
        }
        labelSize={1.15}
        labelColor={() => "rgba(0,0,0,0)"}
        labelDotRadius={0.2}
        labelResolution={2}
        ringsData={ringsData}
        ringLat={(d) => d.lat}
        ringLng={(d) => d.lng}
        ringColor={(d) => (d.isSelected ? COLORS.arc : "#CBD5E0")}
        ringMaxRadius={(d) => (d.isSelected ? 3.8 : 2.4)}
        ringPropagationSpeed={(d) => (d.isSelected ? 1.5 : 0.6)}
        ringRepeatPeriod={d => (d.isSelected ? 900 : 2400)}
      />
    </div>
  );
});

export default LandfallGlobe;
