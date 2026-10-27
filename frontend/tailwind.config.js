export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0E0F12",
        panel: "#15171C",
        raised: "#1C1F26",
        border: "#262A33",
        text: "#E8EAED",
        muted: "#9AA0AC",
        accent: "#5B9DFF",
        positive: "#4CC38A",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
    },
  },
  plugins: [],
};
