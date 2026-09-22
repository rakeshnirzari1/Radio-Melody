// Curated collections. Each preset is just a tag query against Radio-Browser, so
// they stay fresh without us maintaining a list of station IDs, and they work for
// genres the GenreBar does not cover.
export const ROAD_TRIP_PRESETS = [
  {
    key: "80s-drive",
    label: "80s Drive",
    tag: "80s",
    blurb: "Synths, big choruses, open road.",
    accent: "#ff8ab4",
  },
  {
    key: "bollywood-morning",
    label: "Bollywood Morning",
    tag: "bollywood",
    blurb: "Filmi hits and desi breakfast radio.",
    accent: "#ffb454",
  },
  {
    key: "late-night-jazz",
    label: "Late Night Jazz",
    tag: "jazz",
    blurb: "Low lights, brass, no talking.",
    accent: "#b79cff",
  },
  {
    key: "world-news",
    label: "World News Now",
    tag: "news",
    blurb: "Rolling headlines from everywhere.",
    accent: "#7fd4ff",
  },
  {
    key: "lofi-focus",
    label: "Lo-fi Focus",
    tag: "lofi",
    blurb: "Beats to work to, nothing shouty.",
    accent: "#2fe08a",
  },
  {
    key: "rock-classics",
    label: "Rock Classics",
    tag: "classic rock",
    blurb: "Guitars that have been around.",
    accent: "#ff9f7a",
  },
  {
    key: "dance-floor",
    label: "Dance Floor",
    tag: "dance",
    blurb: "Four to the floor, all night.",
    accent: "#7bf0b8",
  },
  {
    key: "country-roads",
    label: "Country Roads",
    tag: "country",
    blurb: "Pedal steel and wide horizons.",
    accent: "#e0c37f",
  },
];

export const presetByKey = (key) => ROAD_TRIP_PRESETS.find((p) => p.key === key) || null;
