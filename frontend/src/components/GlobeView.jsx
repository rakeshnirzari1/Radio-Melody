import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import Globe from "react-globe.gl";
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

const GlobeView = ({ stations, focusStation, userLoc, pins, onStationClick, spinToken }) => {
  const globeRef = useRef();
  const wrapRef = useRef();
  const { current } = usePlayer();
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [ready, setReady] = useState(false);
  const [hovered, setHovered] = useState(null);
  // The circle around a hovered dot is the click target, so the pointer has to be
  // able to travel out of the dot and into the circle without the circle vanishing
  // under it. Clearing is delayed, and entering the circle cancels the clear.
  const hoverClearRef = useRef(null);
  const holdHover = useCallback((p) => {
    if (hoverClearRef.current) {
      clearTimeout(hoverClearRef.current);
      hoverClearRef.current = null;
    }
    setHovered(p);
  }, []);
  const releaseHover = useCallback(() => {
    if (hoverClearRef.current) clearTimeout(hoverClearRef.current);
    hoverClearRef.current = setTimeout(() => {
      hoverClearRef.current = null;
      setHovered(null);
    }, 450);
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
  // radius by the camera distance. The scale is quantised, and the update debounced
  // to the end of a gesture, so the points layer is rebuilt once per zoom instead of
  // continuously blocking the main thread.
  const [dotScale, setDotScale] = useState(1);
  useEffect(() => {
    if (!ready || !globeRef.current) return undefined;
    const controls = globeRef.current.controls();
    const sync = () => {
      const altitude = globeRef.current?.pointOfView?.()?.altitude ?? ZOOM_REF;
      // Anchored at the fly-in altitude, then shrinking in proportion as the camera
      // descends BELOW it. A strictly screen-constant dot would be right at a city
      // zoom and a solid smear at world view (~3,800 dots on a ~550px globe), so full
      // size is kept from world view down to FLY_ALT and the dots scale down with the
      // camera from there. The old formula did the opposite — it grew them as the
      // camera descended, which is how a city's stations became big blobs.
      const FLY_ALT = 0.7;
      const scale = Math.min(1, Math.max(0.13, altitude / FLY_ALT));
      const quantised = Math.round(scale * 8) / 8;
      setDotScale((prev) => (Math.abs(prev - quantised) < 0.01 ? prev : quantised));
    };
    // Debounced. "change" fires continuously through a zoom or a drag, and every
    // update re-creates the whole points layer, which blocks the main thread — and a
    // blocked main thread starves the audio element's clock, which the player reads
    // as a frozen stream and answers with a reconnect. One rebuild per gesture.
    let debounce = null;
    const onControlsChange = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(sync, 140);
    };
    controls.addEventListener("change", onControlsChange);
    sync();
    return () => {
      if (debounce) clearTimeout(debounce);
      controls.removeEventListener("change", onControlsChange);
    };
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

  // Tapping bare map does nothing at all. It used to scan every geolocated station
  // for the nearest one — about 59,000 haversines on every click, a full main-thread
  // stall — and would play a station hundreds of kilometres from where the listener
  // aimed. A station plays when its dot is hit, or when the circle around it is.

  const ringsData = useMemo(() => {
    const rings = [];
    if (current && current.lat != null)
      rings.push({ lat: current.lat, lng: current.lng, kind: "station" });
    if (userLoc) rings.push({ lat: userLoc.lat, lng: userLoc.lng, kind: "user" });
    // Deliberately no ring for the hovered station. With one on hover, sweeping the
    // pointer across a dense cluster started a propagating ring at every station it
    // crossed, which reads as the whole map circling. The ring marks what is playing:
    // one station.
    return rings;
  }, [current, userLoc]);

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
        globeImageUrl="/earth-hi.jpg"
        bumpImageUrl="/earth-topology.png"
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
        // Flat. three-globe draws a point as a column, so any height at all becomes a
        // pillar once the camera is near the ground — the "cylinder" in the report.
        // Nothing is raised now: the ring marks what is playing, and the hover circle
        // marks what is under the pointer.
        pointAltitude={0.001}
        pointRadius={(d) => {
          // Small, flat and screen-constant — a station is a mark on the map, not a
          // ball on the surface. The playing station is singled out by its ring.
          // The playing and hovered stations stay in the same size family as their
          // neighbours — colour and the ring carry the emphasis, not a fatter dot.
          const base =
            current && d.id === current.id
              ? 0.12
              : hovered && d.id === hovered.id
                ? 0.12
                : d._pin
                  ? 0.09
                  : 0.08;
          return base * dotScale;
        }}
        // 8 keeps a dot reading as a circle; at 6 a dot that renders large is a hexagon.
        pointResolution={8}
        pointsMerge={false}
        htmlElementsData={hovered ? [hovered] : []}
        htmlLat="lat"
        htmlLng="lng"
        htmlAltitude={0.004}
        htmlElement={(d) => {
          // A DOM element rather than geometry, so the size is fixed in pixels and
          // therefore constant on screen by construction — and it doubles as the hit
          // area, which is how radio.garden's circle works. Exactly one exists at a
          // time: the station under the pointer. The zero-size parent keeps the circle
          // centred whichever way the library anchors it.
          const outer = document.createElement("div");
          outer.style.cssText = "position:relative;width:0;height:0;";
          const circle = document.createElement("div");
          circle.setAttribute("data-rm-hover-circle", "1");
          circle.style.cssText =
            "position:absolute;left:-13px;top:-13px;width:26px;height:26px;" +
            "border-radius:50%;border:1.5px solid rgba(255,255,255,0.92);" +
            "background:rgba(255,255,255,0.07);box-sizing:border-box;" +
            "cursor:pointer;pointer-events:auto;";
          circle.onmouseenter = () => holdHover(d);
          circle.onmouseleave = () => releaseHover();
          circle.onclick = (e) => {
            e.stopPropagation();
            setHovered(null);
            onStationClick && onStationClick(d);
          };
          outer.appendChild(circle);
          return outer;
        }}
        pointLabel={(d) =>
          // This string is injected as HTML by three-globe, and station names come from
          // a community catalogue (and from imported backups), so they are escaped
          // rather than trusted.
          `<div style="font-family:Inter,sans-serif;background:rgba(5,10,12,0.9);border:1px solid rgba(47,224,138,0.35);color:#e8f0ec;padding:3px 7px;border-radius:6px;font-size:11px;line-height:1.3;max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none"><b style="color:#7bf0b8">${escHtml(d.name)}</b><span style="opacity:.6"> · ${escHtml(d.country || "")}</span></div>`
        }
        onPointHover={(p) => {
          if (p) holdHover(p);
          else releaseHover();
        }}
        onPointClick={(d) => {
          // A tap can leave the hover label up, covering the stations that are about
          // to be tried next — clear it with the selection.
          setHovered(null);
          onStationClick && onStationClick(d);
        }}
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
