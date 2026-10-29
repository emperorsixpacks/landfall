import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import Globe from "react-globe.gl";
import { MeshPhongMaterial } from "three";
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
  const dimsState = useState({ width: 800, height: Math.max(height, 420) });
  const [dims, setDims] = dimsState;
  const globeMaterial = useMemo(
    () => new MeshPhongMaterial({ 
      color: COLORS.base,
      emissive: "#FFFFFF",
      emissiveIntensity: 0.05,
      shininess: 15,
      specular: "#E2E8F0",
    }),
    []
  );

  // Size the canvas to its container, min height 420.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setDims({ width: r.width, height: Math.max(r.height, 420) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const ranked = rankMarkets(markets);
  const top3 = ranked.filter((m) => m.status !== "no_data" && m.score != null).slice(0, 3);
  const top5 = ranked.filter((m) => m.status !== "no_data" && m.score != null).slice(0, 5);

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
      if (!cancelled) g.pointOfView({ lat: 15, lng: 0, altitude: 2.5 }, 1200);
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
      if (g) g.pointOfView({ lat: 15, lng: 0, altitude: 2.5 }, 800);
    },
    saveImage() {
      const g = globeEl.current;
      if (g) return g.renderer().domElement.toDataURL("image/png");
      return null;
    },
    startTour() {
      const g = globeEl.current;
      if (!g) return;
      g.pointOfView({ lat: 15, lng: 0, altitude: 2.5 }, 1000);
    },
  }));

  const scoredPoints = showMarkets
    ? ranked.map((m) => ({ ...m, isNoData: m.status === "no_data" || m.score == null }))
    : [];

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
  // No-data markets render as small hollow gray rings.
  if (showMarkets) {
    for (const m of ranked) {
      if (m.status === "no_data" && m.lat != null) ringsData.push({ ...m, isSelected: false });
    }
  }

  const venues = showVenues
    ? ranked.flatMap((m) => (m.venues || []).map((v) => ({ ...v, market: m.city })))
    : [];

  return (
    <div ref={wrapRef} className="h-full w-full" style={{ minHeight: 420 }}>
      <Globe
        ref={globeEl}
        width={dims.width}
        height={dims.height}
        backgroundColor="rgba(255,255,255,0)"
        globeMaterial={globeMaterial}
        atmosphereColor={COLORS.atmosphere}
        atmosphereAltitude={0.12}
        hexPolygonsData={LAND}
        hexPolygonResolution={3}
        hexPolygonMargin={0.68}
        hexPolygonColor={() => COLORS.land}
        hexPolygonAltitude={0.003}
        polygonsData={LAND}
        polygonCapColor={() => "rgba(0,0,0,0)"}
        polygonSideColor={() => "rgba(0,0,0,0)"}
        polygonStrokeColor={() => "#4A5568"}
        polygonAltitude={0.01}
        polygonCapCurvatureResolution={2}
        pointsData={scoredPoints}
        pointLat={(d) => d.lat}
        pointLng={(d) => d.lng}
        pointAltitude={(d) => (d.isNoData ? 0.004 : 0.006 + (d.score ?? 0) / 100 * 0.08)}
        pointRadius={(d) => (d.isNoData ? 0.12 : 0.25 + (d.score ?? 0) / 100 * 0.8)}
        pointColor={(d) => (d.isNoData ? COLORS.noData : scoreToColor(d.score, d.rank))}
        pointLabel={(d) => {
          if (d.isNoData) {
            return `<div class="globe-tip"><b>${d.city}</b><span>no Qloo data</span></div>`;
          }
          return `<div class="globe-tip"><b>${d.city}</b><span class="num">${d.score}</span><small>${d.reason}</small></div>`;
        }}
        onPointHover={(d) => onHover && onHover(d ? d.city : null)}
        onPointClick={(d) => {
          if (d && onSelect) onSelect(d.city);
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
        pointsMerge
      />
    </div>
  );
});

export default LandfallGlobe;
