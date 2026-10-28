import React, { Component, lazy, Suspense, useState } from "react";
import { webglAvailable } from "../lib/globeUtils";
import GlobeFallback from "./GlobeFallback";

const Globe = lazy(() => import("./Globe"));

class GlobeErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error, info) {
    console.error("Globe render failed, falling back to 2D view:", error, info);
    this.props.onError?.(error);
  }
  render() {
    if (this.state.failed) return <GlobeFallback {...this.props} />;
    return this.props.children;
  }
}

// Lazy-loads the WebGL globe so the home page stays fast; falls back to an SVG
// dot-map when WebGL is unavailable or the renderer throws.
export default function GlobeContainer(props) {
  const [webgl] = useState(() => webglAvailable());
  if (!webgl) return <GlobeFallback {...props} />;
  return (
    <GlobeErrorBoundary {...props}>
      <Suspense fallback={<GlobeFallback {...props} />}>
        <Globe {...props} />
      </Suspense>
    </GlobeErrorBoundary>
  );
}
