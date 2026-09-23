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
    controls.minDistance = 140;
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
      // Anchored at the fly-in altitude and shrinking below it. The previous formula
      // was the inverse — it GREW the dots as the camera came down (up to 3.4x), which
      // is how a city's dots became big blobs. radio.garden's dots are the same small
      // size at every zoom, so full size is kept from world view down to the fly-in and
      // they scale down with the camera past that.
      const FLY_ALT = 0.7;
      const scale = Math.min(1, Math.max(0.13, altitude / FLY_ALT));
      const quantised = Math.round(scale * 20) / 20;
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
          // All four in the same size family. The playing and hovered dots used to be
          // 2.4x fatter than their neighbours, which is a blob at city zoom; colour and
          // the ring carry the emphasis instead.
          const base =
            current && d.id === current.id
              ? 0.11
              : hovered && d.id === hovered.id
                ? 0.11
                : d._pin
                  ? 0.09
                  : 0.08;
          return base * dotScale;
        }}
        // 8 keeps a dot reading as a circle; at 6 a dot that renders large is a hexagon.
        pointResolution={8}
        pointsMerge={false}
        pointLabel={(d) =>
          // This string is injected as HTML by three-globe, and station names come from
          // a community catalogue (and from imported backups), so they are escaped
          // rather than trusted.
          `<div style="font-family:Inter,sans-serif;background:rgba(5,10,12,0.92);border:1px solid rgba(47,224,138,0.4);color:#e8f0ec;padding:6px 10px;border-radius:8px;font-size:12px;max-width:220px"><b style="color:#7bf0b8">${escHtml(d.name)}</b><br/><span style="opacity:.7">${escHtml(d.state ? d.state + ", " : "")}${escHtml(d.country || "")}</span></div>`
        }
        onPointHover={(p) => setHovered(p || null)}
        onPointClick={(d) => onStationClick && onStationClick(d)}
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
          // The hover wave is a tight pulse, not a ripple across the map: 1.8 degrees
          // reached most of a city's stations and kept going.
          (d.kind === "hover" ? 0.7 : d.kind === "user" ? 5 : 4) * dotScale
        }
        ringPropagationSpeed={(d) => (d.kind === "hover" ? 2 : 3)}
        // At 1600ms between repeats a normal hover shows one round, two at most. The old
        // 500ms fired a continuous stream of them, which is the "so many circles" report.
        ringRepeatPeriod={(d) => (d.kind === "hover" ? 1600 : 900)}
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
