import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import Globe from "react-globe.gl";
import { toast } from "sonner";
import { usePlayer } from "../context/PlayerContext";
import { genreColor } from "../lib/genreColor";

// Camera altitude the dot sizes are tuned at — three-globe's world view. Dot sizes
// are held constant *on screen* relative to this, the way radio.garden's are.
const ZOOM_REF = 2.4;
// Landing altitude by station density. The camera distance is (1 + altitude) x 100 Earth
// radii and the default field of view is 45 degrees, so a point spread of N degrees maps
// to an altitude: at 100 Earth radii one degree spans about 0.573 x 0.414 of the frame.
// The aim is a starting view where a sensible number of dots are visible — a dense city
// does not open as a wall of overlapping dots and an empty ocean does not open blank.
const LANDING_DOTS = 45; // roughly how many stations to have in frame on arrival
const LAND_ALT_MIN = 0.5; // clear of the 0.45 handover into the tiled deep view
const LAND_ALT_MAX = 2.4; // the world view the dot sizes are tuned at

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

// Which display cell a station belongs to. Shared by the points and the hover fan so
// they always agree on what a dot represents.
const cellKeyFor = (s, cell) => `${Math.round(s.lat / cell)}:${Math.round(s.lng / cell)}`;

const GlobeView = ({ stations, focusStation, userLoc, pins, onStationClick, spinToken, onReachFloor, onViewChange }) => {
  const globeRef = useRef();
  const wrapRef = useRef();
  const { current } = usePlayer();
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [ready, setReady] = useState(false);
  const [hovered, setHovered] = useState(null);
  // Read through a ref: the camera loop below must not hold a stale callback.
  const floorRef = useRef(null);
  floorRef.current = onReachFloor;
  // Same hazard, and it was live: the camera loop is registered once per `ready` and
  // closes over the app's station list, so it kept the copy from before the catalogue
  // had loaded. Every report resolved against an empty list and cleared the country,
  // which is a pill that can never render. Read the prop through a ref instead.
  const viewChangeRef = useRef(null);
  viewChangeRef.current = onViewChange;
  // The fan circles the hovered dot, so the pointer has to be able to travel out of the
  // dot and into the fan without the whole thing vanishing under it. Clearing is
  // delayed, and entering a fan dot cancels the clear.
  const hoverClearRef = useRef(null);
  const holdHover = useCallback((p) => {
    if (hoverClearRef.current) {
      clearTimeout(hoverClearRef.current);
      hoverClearRef.current = null;
    }
    setHovered((prev) => (prev && p && prev.id === p.id ? prev : p));
  }, []);
  const releaseHover = useCallback(() => {
    if (hoverClearRef.current) clearTimeout(hoverClearRef.current);
    hoverClearRef.current = setTimeout(() => {
      hoverClearRef.current = null;
      setHovered(null);
    }, 400);
  }, []);

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
    const aspect = globeRef.current.camera?.()?.aspect ?? 1;
    globeRef.current.pointOfView(
      {
        lat: focusStation.lat,
        lng: focusStation.lng,
        altitude: landingAltitude(focusStation.lat, focusStation.lng, aspect),
      },
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
  // Last position we reported upward, so the camera loop reports on moves only. Starts
  // null on purpose: the first sync must always report, whatever the camera's opening
  // position happens to be, so the app learns where it is looking without a drag.
  const viewRef = useRef(null);
  useEffect(() => {
    if (!ready || !globeRef.current) return undefined;
    const controls = globeRef.current.controls();
    const sync = () => {
      const altitude = globeRef.current?.pointOfView?.()?.altitude ?? ZOOM_REF;
      // Tell the app where the camera is looking, so it can offer the full list for
      // whichever country is in frame. Throttled to real moves: OrbitControls only
      // fires change on movement, and reporting on a 5-degree grid keeps it off the
      // frame budget. onViewChange is optional, so a missing prop is harmless.
      const _pov = globeRef.current?.pointOfView?.();
      const _report = viewChangeRef.current;
      if (_pov && _report) {
        const _v = viewRef.current;
        const _moved = _v ? Math.abs(_pov.lat - _v.lat) + Math.abs(_pov.lng - _v.lng) : 999;
        if (_moved > 5) {
          viewRef.current = { lat: _pov.lat, lng: _pov.lng };
          // DEBUG HOOK - remove once the camera link is confirmed on the live site.
          // Proves the report left the globe, separately from what the app did with it.
          try {
            window.__wrView = { lat: _pov.lat, lng: _pov.lng, altitude: altitude, at: Date.now() };
          } catch (e) { /* no window in a test renderer */ }
          _report(_pov.lat, _pov.lng, altitude);
        }
      }
      // The floor of the 3D view (~2,500 km up, minDistance 140). Past it a texture on a
      // sphere is just a bigger blur, so hand over to real tiles. Idempotent on the App
      // side, so firing every frame while parked at the floor is harmless.
      if (altitude <= 0.45 && floorRef.current) floorRef.current();
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

  // The display grid tightens as the camera descends: coarse at world view so the whole
  // planet stays light, fine at city zoom so a metro's stations separate instead of
  // stacking into one dot. Five steps, not a smooth ramp — rebuilding the points layer
  // is the expensive part it does on every change.
  const CELL_STEPS = [0.5, 0.25, 0.12, 0.06, 0.03];
  const cellSize = useMemo(() => {
    const i = Math.min(
      CELL_STEPS.length - 1,
      Math.max(0, Math.round((1 - dotScale) * (CELL_STEPS.length - 1)))
    );
    return CELL_STEPS[i];
  }, [dotScale]);

  // Every station per cell, kept so a hovered dot can fan out the ones it represents.
  const cellMembersRef = useRef(new Map());

  const pointsData = useMemo(() => {
    // Radio-Browser has dozens of entries per city, often on identical
    // coordinates, so plotting every station turns dense regions into one solid
    // green smear. Collapse them onto a display grid — the queue still uses the full
    // list, so Next/Back are unaffected. The most-clicked station in each cell
    // represents it, and the rest are reachable through the hover fan.
    const CELL = cellSize;
    const cells = new Map();
    const members = new Map();
    for (const s of stations || []) {
      if (s.lat == null || s.lng == null) continue;
      const key = cellKeyFor(s, CELL);
      let bucket = members.get(key);
      if (!bucket) {
        bucket = [];
        members.set(key, bucket);
      }
      if (bucket.length < 24) bucket.push(s);
      if (current && s.id === current.id) continue; // drawn separately, always shown
      const prev = cells.get(key);
      if (!prev || (s.clickcount || 0) > (prev.clickcount || 0)) cells.set(key, s);
    }
    cellMembersRef.current = members;
    const out = [...cells.values()];
    if (current && current.lat != null && !out.some((s) => s.id === current.id)) {
      out.push({ ...current, _live: true });
    }
    const pinPts = (pins || [])
      .filter((s) => s.lat != null && s.lng != null)
      .map((s) => ({ ...s, _pin: true }));
    return [...out, ...pinPts];
  }, [stations, pins, current, cellSize]);

  // Hovering a dot rings the stations it stands for around it, so a city with forty
  // stations on one block is reachable instead of being a single anonymous dot. They
  // are ordinary stations with their coordinates nudged outwards, so clicking one plays
  // it through the same path as any other dot.
  const fanData = useMemo(() => {
    if (!hovered || hovered._fan || hovered.lat == null) return [];
    const mates = (cellMembersRef.current.get(cellKeyFor(hovered, cellSize)) || []).filter(
      (s) => s.id !== hovered.id && s.url
    );
    if (!mates.length) return [];
    const n = Math.min(mates.length, 8);
    // Screen-ish constant: the ring of fans stays a comfortable size at any zoom.
    const r = 0.9 * dotScale;
    const cosLat = Math.max(0.2, Math.cos((hovered.lat * Math.PI) / 180));
    return mates.slice(0, n).map((s, i) => {
      const a = (i / n) * Math.PI * 2;
      return {
        ...s,
        _fan: true,
        lat: Math.max(-85, Math.min(85, hovered.lat + Math.sin(a) * r)),
        lng: hovered.lng + (Math.cos(a) * r) / cosLat,
      };
    });
  }, [hovered, cellSize, dotScale]);

  const allPoints = useMemo(() => [...pointsData, ...fanData], [pointsData, fanData]);

  // Geolocated stations for nearest-station picking.
  const geoStations = useMemo(
    () => (stations || []).filter((s) => s.lat != null && s.lng != null),
    [stations]
  );

  // One pass over the station list into one-degree cells, so asking "how busy is it
  // around this point" is a few map lookups rather than a scan of 58,000 stations.
  const densityCells = useMemo(() => {
    const cells = new Map();
    for (const st of stations || []) {
      if (st.lat == null || st.lng == null) continue;
      const k = Math.floor(st.lat) + ":" + Math.floor(st.lng);
      cells.set(k, (cells.get(k) || 0) + 1);
    }
    return cells;
  }, [stations]);

  // How many degrees around a point hold LANDING_DOTS stations, and the altitude that
  // frames that. Portrait phones see less width, hence the aspect term.
  const landingAltitude = useCallback(
    (lat, lng, aspect) => {
      const clat = Math.floor(lat);
      const clng = Math.floor(lng);
      let total = densityCells.get(clat + ":" + clng) || 0;
      let r = 0;
      while (total < LANDING_DOTS && r < 45) {
        r += 1;
        for (let a = -r; a <= r; a += 1) {
          for (let b = -r; b <= r; b += 1) {
            if (Math.max(Math.abs(a), Math.abs(b)) !== r) continue;
            total += densityCells.get(clat + a + ":" + (clng + b)) || 0;
          }
        }
      }
      const span = Math.max(r, 1) * 1.6;
      const narrow = Math.min(1, aspect || 1);
      const altitude = span / (0.573 * 0.414 * narrow * 100) - 1;
      return Math.min(LAND_ALT_MAX, Math.max(LAND_ALT_MIN, altitude));
    },
    [densityCells]
  );

  // Set by a tap that landed on empty space, so a double-click knows to dive there.
  // A tap on a dot has already started playing it — zooming underneath that would fight
  // the gesture, and every map the user has ever used puts play on one click.
  const emptyTapRef = useRef(null);

  const handleGlobeDoubleClick = useCallback(() => {
    const g = globeRef.current;
    const at = emptyTapRef.current;
    if (!g || !at || Date.now() - at.at > 700) return;
    const here = g.pointOfView?.();
    const altitude = Math.max(LAND_ALT_MIN, (here?.altitude ?? 0.7) * 0.45);
    g.controls().autoRotate = false;
    // Already as close as the globe goes: keep going into the tiled deep view, so
    // double-click is a continuous "closer" gesture all the way in.
    if ((here?.altitude ?? 1) <= LAND_ALT_MIN + 0.02) {
      onReachFloor && onReachFloor();
      return;
    }
    g.pointOfView({ lat: at.lat, lng: at.lng, altitude }, 700);
  }, [onReachFloor]);

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
        emptyTapRef.current = null;
        onStationClick && onStationClick(best);
      } else {
        emptyTapRef.current = { lat, lng, at: Date.now() };
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
    <div ref={wrapRef} className="absolute inset-0" onDoubleClick={handleGlobeDoubleClick}>
      <Globe
        ref={globeRef}
        width={size.w}
        height={size.h}
        onGlobeReady={() => setReady(true)}
        backgroundColor="rgba(0,0,0,0)"
        globeImageUrl="/earth-hi.webp"
        bumpImageUrl="/earth-topo.webp"
        showAtmosphere={true}
        atmosphereColor="#7fd4ff"
        atmosphereAltitude={0.2}
        pointsData={allPoints}
        pointLat="lat"
        pointLng="lng"
        pointColor={(d) =>
          current && d.id === current.id
            ? "#ffffff"
            : hovered && d.id === hovered.id
              ? "#eafff4"
              : d._fan
                ? "#ffd9a0"
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
          const base = d._fan
            ? 0.07
            : 
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
        onPointHover={(p) => {
          if (p) holdHover(p);
          else releaseHover();
        }}
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
