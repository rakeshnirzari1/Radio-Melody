// Colour the globe by what a station actually is.
//
// The map used to be a wall of identical green: with several stations per city you
// could not tell news from drum-and-bass, and the brand colour stopped meaning
// anything because everything was wearing it. Now the accent green is reserved for
// the station you are listening to, and everything else is coloured by family.
//
// Radio-Browser tags are a loose comma-separated string — often absent, sometimes
// a paragraph — so this matches keywords in priority order against the tags AND
// the station name, then falls back to a neutral grey-green. Matching is done on
// whole tokens (or whole phrases) so "Popular FM" is not classified as pop.

export const DEFAULT_COLOR = "#7f9a90";

const FAMILIES = [
  {
    key: "news",
    label: "News & current affairs",
    color: "#58a6ff",
    words: ["news", "current affairs", "information", "radio news", "world news"],
  },
  {
    key: "talk",
    label: "Talk & podcasts",
    color: "#9db4ff",
    words: ["talk", "speech", "podcast", "interview", "discussion", "chat", "comedy"],
  },
  {
    key: "sport",
    label: "Sport",
    color: "#ffb454",
    words: ["sport", "sports", "football", "soccer", "cricket", "rugby", "league", "afl", "nrl", "basketball", "motorsport"],
  },
  {
    key: "classical",
    label: "Classical & opera",
    color: "#d0bfff",
    words: ["classical", "opera", "symphony", "orchestra", "baroque", "chamber", "choral"],
  },
  {
    key: "jazz",
    label: "Jazz, blues & soul",
    color: "#f2c744",
    words: ["jazz", "blues", "soul", "swing", "funk", "motown", "reggae", "ska"],
  },
  {
    key: "rock",
    label: "Rock & metal",
    color: "#ff6b6b",
    words: ["rock", "metal", "punk", "grunge", "alternative", "indie", "hardcore", "emo"],
  },
  {
    key: "pop",
    label: "Pop & hits",
    color: "#ff8fd0",
    words: ["pop", "top 40", "hits", "hit music", "charts", "hits radio", "adult contemporary", "easy listening"],
  },
  {
    key: "electronic",
    label: "Electronic & dance",
    color: "#57e0d0",
    words: ["electronic", "dance", "techno", "house", "trance", "edm", "drum and bass", "dnb", "ambient", "chillout", "lounge", "club"],
  },
  {
    key: "country",
    label: "Country & folk",
    color: "#d9a066",
    words: ["country", "folk", "bluegrass", "americana", "western"],
  },
  {
    key: "world",
    label: "World & regional",
    color: "#a6e3a1",
    words: ["world", "community", "local", "regional", "bollywood", "hindi", "arabic", "latin", "afrobeat", "k-pop", "desi"],
  },
];

// Whole-token match for a single word, phrase-boundary match for multi-word terms.
// No regex escapes are used anywhere here on purpose (see the repo notes about
// patching regexes on this host).
const matches = (hay, tokens, word) => {
  if (word.includes(" ")) {
    const pattern = new RegExp(`(?:^|[^a-z0-9])${word}(?:[^a-z0-9]|$)`);
    return pattern.test(hay);
  }
  return tokens.includes(word);
};

export const genreFamily = (station) => {
  const tags = String((station && station.tags) || "").toLowerCase();
  const name = String((station && station.name) || "").toLowerCase();
  const hay = `${tags} ${name}`;
  const tokens = hay.split(/[^a-z0-9]+/).filter(Boolean);
  for (const family of FAMILIES) {
    if (family.words.some((w) => matches(hay, tokens, w))) return family;
  }
  return null;
};

export const genreColor = (station) => {
  const family = genreFamily(station);
  return family ? family.color : DEFAULT_COLOR;
};

export const genreLabel = (station) => {
  const family = genreFamily(station);
  return family ? family.label : "Other";
};

export const LEGEND = FAMILIES.map(({ key, label, color }) => ({ key, label, color }));
