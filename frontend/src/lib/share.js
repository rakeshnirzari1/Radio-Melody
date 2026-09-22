// Absolute URLs that keep the GitHub Pages base path.
//
// The site may be served from the origin root or from a subpath, so a link built from
// window.location.origin alone drops the "/<repo>" part and 404s when shared.
// CRA's PUBLIC_URL carries that base path at build time.

export const BASE_PATH = (process.env.PUBLIC_URL || "").replace(/\/+$/, "");

export const absoluteUrl = (path = "/") =>
  `${window.location.origin}${BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`;
