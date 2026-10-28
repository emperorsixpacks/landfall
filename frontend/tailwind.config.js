export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      screens: {
        desktop: "1100px",
      },
      colors: {
        bg: "#0E0F12",
        panel: "#15171C",
        raised: "#1C1F26",
        border: "#262A33",
        text: "#E8EAED",
        secondary: "#9AA0AC",
        muted: "#7A808C",
        accent: "#5B9DFF",
        positive: "#4CC38A",
        warn: "#E5B455",
        danger: "#F26D6D",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      fontSize: {
        display: ["44px", { lineHeight: "48px", letterSpacing: "-0.02em", fontWeight: "600" }],
        h1: ["32px", { lineHeight: "1.2" }],
        h2: ["22px", { lineHeight: "1.3" }],
        body: ["15px", { lineHeight: "1.6" }],
        small: ["13px", { lineHeight: "1.4" }],
        label: ["11px", { lineHeight: "1.2", letterSpacing: "0.06em", textTransform: "uppercase" }],
        mono: ["12px", { lineHeight: "1.4", fontVariantNumeric: "tabular-nums" }],
      },
      spacing: {
        // 4px grid
        1: "4px",
        2: "8px",
        3: "12px",
        4: "16px",
        5: "20px",
        6: "24px",
        8: "32px",
        10: "40px",
        12: "48px",
        14: "56px",
        16: "64px",
      },
      borderRadius: {
        card: "12px",
        control: "8px",
        pill: "9999px",
      },
      maxWidth: {
        container: "1200px",
      },
      transitionTimingFunction: {
        "ease-out": "cubic-bezier(0.2, 0.8, 0.2, 1)",
      },
      transitionDuration: {
        120: "120ms",
        200: "200ms",
        320: "320ms",
        600: "600ms",
        1200: "1200ms",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "draw-stroke": {
          from: { strokeDashoffset: "1" },
          to: { strokeDashoffset: "0" },
        },
        "scale-pop": {
          "0%": { transform: "scale(0.96)" },
          "50%": { transform: "scale(1.02)" },
          "100%": { transform: "scale(1)" },
        },
        pulse: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.6" },
        },
      },
      animation: {
        "fade-up": "fade-up 420ms var(--ease-out)",
        "draw-stroke": "draw-stroke 400ms var(--ease-out)",
        "scale-pop": "scale-pop 180ms var(--ease-out)",
        pulse: "pulse 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
