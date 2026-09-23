import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import Globe from "react-globe.gl";
import { toast } from "sonner";
import { usePlayer } from "../context/PlayerContext";
import { genreColor } from "../lib/genreColor";

// Camera altitude the dot sizes are tuned at — three-globe's world view. Dot sizes
// are held constant *on screen* relative to this, the way radio.garden's are.
const ZOOM_REF = 2.4;

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
// three-globe renders point labels as raw HTML. Station names are community data (and
// arrive again through backup imports), so they are escaped before they go anywhere
// near that string.
const escHtml = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

const R_EARTH_KM = 6371;

const haversineKm = (lat1, lon1, lat2, lon2) => {
  const p = Math.PI / 180;
  const a =
    0.5 -
    Math.cos((lat2 - lat1) * p) / 2 +
    (Math.cos(lat1 * p) * Math.cos(lat2 * p) * (1 - Math.cos((lon2 - lon1) * p))) / 2;
  return 2 * R_EARTH_KM * Math.asin(Math.sqrt(Math.max(0, a)));
};

const GlobeView = ({ stations, focusStation, userLoc, pins, onStationClick, spinToken }) => {
  const globeRef = useRef();
  const wrapRef = useRef();
  const { current } = usePlayer();
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [ready, setReady] = useState(false);
  const [hovered, setHovered] = useState(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!globeRef.current || !ready) return;
    const controls = globeRef.current.controls();
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.32;
    controls.enableZoom = true;
    // Deep enough to pull a city's stations apart. At 105 the camera sits about
    // 300 km above the ground, where a metro cluster such as Sydney's spreads over
    // roughly a fifth of the screen instead of collapsing into one green smear.
    controls.minDistance = 105;
    controls.maxDistance = 600;
    globeRef.current.pointOfView({ lat: 20, lng: 0, altitude: 2.4 }, 0);
    const stopRotate = () => (controls.autoRotate = false);
    const dom = globeRef.current.renderer().domElement;
    dom.addEventListener("pointerdown", stopRotate);
    return () => dom.removeEventListener("pointerdown", stopRotate);
  }, [ready]);

  // Fly to whatever is playing — on load, on Next/Back, on Surprise me, on a map
  // tap. Kept in a ref as well so a station that starts before the globe has
  // finished loading still ends up centred once it is ready (the animation was
  // simply lost before, which is why the map sometimes stayed where it was).
  const pendingFocusRef = useRef(null);

  useEffect(() => {
    if (!focusStation) return;
    pendingFocusRef.current = focusStation;
    if (!globeRef.current || !ready) return;
    if (focusStation.lat == null || focusStation.lng == null) return;
    globeRef.current.controls().autoRotate = false;
    globeRef.current.pointOfView(
      { lat: focusStation.lat, lng: focusStation.lng, altitude: 0.7 },
      1400
    );
    pendingFocusRef.current = null;
  }, [focusStation, ready]);

  // Spin the globe: one fast rotation that decelerates to a stop while the app
  // picks a station. Deliberately does not animate the landing itself — the normal
  // fly-in takes over the moment the station starts, so there is only ever one
  // animation in charge of where the camera ends up.
  useEffect(() => {
    if (!spinToken || !globeRef.current || !ready) return undefined;
    const controls = globeRef.current.controls();
    controls.autoRotate = true;
    let speed = 9;
    let raf = 0;
    let last = performance.now();
    const step = (now) => {
      const dt = Math.min(64, now - last) / 1000;
      last = now;
      speed = Math.max(0, speed - dt * 5.5); // ~1.6 seconds of deceleration
      controls.autoRotateSpeed = speed;
      if (speed > 0.05) {
        raf = requestAnimationFrame(step);
      } else {
        controls.autoRotate = false;
        controls.autoRotateSpeed = 0.32;
      }
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      controls.autoRotate = false;
      controls.autoRotateSpeed = 0.32;
    };
  }, [spinToken, ready]);

  // radio.garden's dots are markers: they stay the same size on screen however far
  // you zoom in. three-globe draws them as real geometry, so they grow as the camera
  // descends — and because the app flies in to the playing station (altitude 0.7) the
  // dots looked like marbles exactly where the user was looking. Counter-scale the
  // radius by the camera distance. The scale is quantised to fifths so the point
  // geometry is rebuilt a handful of times per zoom rather than every frame.
  const [dotScale, setDotScale] = useState(1);
  useEffect(() => {
    if (!ready || !globeRef.current) return undefined;
    const controls = globeRef.current.controls();
    const sync = () => {
      const altitude = globeRef.current?.pointOfView?.()?.altitude ?? ZOOM_REF;
      const scale = Math.min(
        7, // must cover the deepest zoom (minDistance 105 -> altitude 0.05)
        Math.max(0.6, (ZOOM_REF + 0.35) / (altitude + 0.35))
      );
      const quantised = Math.round(scale * 5) / 5;
      setDotScale((prev) => (Math.abs(prev - quantised) < 0.01 ? prev : quantised));
    };
    controls.addEventListener("change", sync);
    sync();
    return () => controls.removeEventListener("change", sync);
  }, [ready]);

  const pointsData = useMemo(() => {
    // Radio-Browser has dozens of entries per city, often on identical
    // coordinates, so plotting every station turns dense regions into one solid
    // green smear. Collapse them onto a coarse grid for DISPLAY only — the queue
    // still uses the full list, so Next/Back are unaffected. The most-clicked
    // station in each cell represents it.
    const CELL = 0.3; // degrees, roughly 33 km
    const cells = new Map();
    for (const s of stations || []) {
      if (s.lat == null || s.lng == null) continue;
      if (current && s.id === current.id) continue; // drawn separately, always shown
      const key = `${Math.round(s.lat / CELL)}:${Math.round(s.lng / CELL)}`;
      const prev = cells.get(key);
      if (!prev || (s.clickcount || 0) > (prev.clickcount || 0)) cells.set(key, s);
    }
    const out = [...cells.values()];
    if (current && current.lat != null && !out.some((s) => s.id === current.id)) {
      out.push({ ...current, _live: true });
    }
    const pinPts = (pins || [])
      .filter((s) => s.lat != null && s.lng != null)
      .map((s) => ({ ...s, _pin: true }));
    return [...out, ...pinPts];
  }, [stations, pins, current]);

  // Geolocated stations for nearest-station picking.
  const geoStations = useMemo(
    () => (stations || []).filter((s) => s.lat != null && s.lng != null),
    [stations]
  );

  // Tap anywhere on the globe and get the closest station, radio.garden style.
  // A dot is only a couple of pixels across at world zoom, so demanding a
  // pixel-perfect hit is the wrong interaction — especially on a phone. The
  // tolerance grows as you zoom out.
  const handleGlobeClick = useCallback(
    ({ lat, lng }) => {
      if (!geoStations.length) return;
      const altitude = globeRef.current?.pointOfView?.()?.altitude ?? 2.4;
      const toleranceKm = 150 + altitude * 450;

      let best = null;
      let bestDist = Infinity;
      for (const s of geoStations) {
        const d = haversineKm(lat, lng, s.lat, s.lng);
        if (d < bestDist) {
          bestDist = d;
          best = s;
        }
      }
      if (best && bestDist <= toleranceKm) {
        onStationClick && onStationClick(best);
      } else {
        toast.info("No stations near there", {
          description: "Try tapping closer to a glowing dot.",
        });
      }
    },
    [geoStations, onStationClick]
  );

  const ringsData = useMemo(() => {
    const rings = [];
    if (current && current.lat != null)
      rings.push({ lat: current.lat, lng: current.lng, kind: "station" });
    if (userLoc) rings.push({ lat: userLoc.lat, lng: userLoc.lng, kind: "user" });
    if (hovered && hovered.lat != null)
      rings.push({ lat: hovered.lat, lng: hovered.lng, kind: "hover" });
    return rings;
  }, [current, userLoc, hovered]);

  const labelsData = useMemo(
    () => (userLoc ? [{ lat: userLoc.lat, lng: userLoc.lng, text: "You are here" }] : []),
    [userLoc]
  );

  return (
    <div ref={wrapRef} className="absolute inset-0">
      <Globe
        ref={globeRef}
        width={size.w}
        height={size.h}
        onGlobeReady={() => setReady(true)}
        backgroundColor="rgba(0,0,0,0)"
        globeImageUrl="//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
        bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
        showAtmosphere={true}
        atmosphereColor="#7fd4ff"
        atmosphereAltitude={0.2}
        pointsData={pointsData}
        pointLat="lat"
        pointLng="lng"
        pointColor={(d) =>
          current && d.id === current.id
            ? "#ffffff"
            : hovered && d.id === hovered.id
              ? "#eafff4"
              : d._pin
                ? "#ffb454"
                : genreColor(d)
        }
        pointAltitude={(d) =>
          current && d.id === current.id
            ? 0.02
            : hovered && d.id === hovered.id
              ? 0.016
              : d._pin
                ? 0.008
                : 0.002
        }
        pointRadius={(d) => {
          // Small, flat and screen-constant — a station is a mark on the map, not a
          // ball on the surface. The playing station is singled out by its ring.
          const base =
            current && d.id === current.id
              ? 0.19
              : hovered && d.id === hovered.id
                ? 0.21
                : d._pin
                  ? 0.14
                  : 0.08;
          return base * dotScale;
        }}
        pointResolution={6}
        pointsMerge={false}
        pointLabel={(d) =>
          // This string is injected as HTML by three-globe, and station names come from
          // a community catalogue (and from imported backups), so they are escaped
          // rather than trusted.
          `<div style="font-family:Inter,sans-serif;background:rgba(5,10,12,0.9);border:1px solid rgba(47,224,138,0.35);color:#e8f0ec;padding:3px 7px;border-radius:6px;font-size:11px;line-height:1.3;max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none"><b style="color:#7bf0b8">${escHtml(d.name)}</b><span style="opacity:.6"> · ${escHtml(d.country || "")}</span></div>`
        }
        onPointHover={(p) => setHovered(p || null)}
        onPointClick={(d) => {
          // A tap can leave the hover label up, covering the stations that are about
          // to be tried next — clear it with the selection.
          setHovered(null);
          onStationClick && onStationClick(d);
        }}
        onGlobeClick={handleGlobeClick}
        ringsData={ringsData}
        ringColor={(d) =>
          d.kind === "hover"
            ? (t) => `rgba(234,255,244,${0.75 * (1 - t)})`
            : d.kind === "user"
              ? (t) => `rgba(127,212,255,${1 - t})`
              : (t) => `rgba(55,245,154,${1 - t})`
        }
        ringMaxRadius={(d) =>
          (d.kind === "hover" ? 1.8 : d.kind === "user" ? 5 : 4) * dotScale
        }
        ringPropagationSpeed={(d) => (d.kind === "hover" ? 1.4 : 3)}
        ringRepeatPeriod={(d) => (d.kind === "hover" ? 500 : 900)}
        labelsData={labelsData}
        labelLat="lat"
        labelLng="lng"
        labelText="text"
        labelSize={1.1}
        labelDotRadius={0.5}
        labelColor={() => "#7fd4ff"}
        labelResolution={2}
      />
    </div>
  );
};

export default GlobeView;
