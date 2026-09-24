// Deep view: a real tiled map, for when the globe runs out of resolution.
//
// The globe tops out about 2,500 km above the surface (minDistance 140), which is as
// close as a single texture on a sphere can usefully go — past that it is just a bigger
// blur. This takes over from there with real imagery tiles, so a city is a city.
//
// MILESTONE 1. Deliberately minimal and additive:
//   - Leaflet + Esri World Imagery, both fetched only when this component is first
//     rendered, so nobody who stays on the globe pays a byte for it.
//   - Dots on a canvas renderer, culled to the viewport with a cap, because the full
//     station list is far more than a map should try to draw.
//   - The playing station marked, and clicking a dot plays it through the same
//     onStationClick the globe uses, so the queue and the lock screen are unchanged.
//   - Everything else (hover fan, drive-mode layout, Locate me) is Milestone 2.
//
// If Leaflet or the tiles fail to load, this shows a message and a way back: the globe
// is still mounted underneath and untouched.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

// Esri's imagery is free to use with credit; see the attribution below. maxNativeZoom
// stops the tiles being upscaled past the point where they are real imagery.
const TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const ATTRIBUTION =
  'Imagery &copy; <a href="https://www.esri.com/" target="_blank" rel="noreferrer">Esri</a>, Maxar, Earthstar Geographics';
const MAX_NATIVE_ZOOM = 17;
const DOT_CAP = 1500; // per redraw: more than fits on a screen at any useful zoom

const DeepMap = ({ stations, current, pins, onStationClick, onBack }) => {
  const boxRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const [failed, setFailed] = useState(false);

  const start = useMemo(() => {
    const s = current && current.lat != null ? current : null;
    return {
      center: s ? [s.lat, s.lng] : [-33.8688, 151.2093],
      zoom: s ? 12 : 4,
    };
  }, [current]);

  // Draw the dots for whatever is on screen. Called on mount and on every move/zoom.
  const draw = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const group = L.layerGroup();
    const bounds = map.getBounds().pad(0.15);
    const list = (stations || []).filter(
      (s) => s && s.lat != null && s.lng != null && bounds.contains([s.lat, s.lng]) && s.url
    );
    const trimmed = list.slice(0, DOT_CAP);
    trimmed.forEach((s) => {
      const playing = current && s.id === current.id;
      const pinned = (pins || []).some((p) => p.id === s.id);
      L.circleMarker([s.lat, s.lng], {
        radius: playing ? 7 : 4,
        color: playing ? "#eafff4" : pinned ? "#ffb454" : "#7bf0b8",
        weight: playing ? 2 : 1,
        opacity: 0.95,
        fillColor: playing ? "#2fe08a" : pinned ? "#ffb454" : "#2fe08a",
        fillOpacity: playing ? 0.85 : 0.7,
        bubblingMouseEvents: false,
      })
        .on("click", (e) => {
          L.DomEvent.stop(e);
          onStationClick && onStationClick(s);
        })
        .bindTooltip(`${s.name}${s.country ? " — " + s.country : ""}`, {
          direction: "top",
          offset: [0, -6],
          opacity: 0.92,
        })
        .addTo(group);
    });
    if (layerRef.current) map.removeLayer(layerRef.current);
    group.addTo(map);
    layerRef.current = group;
    return trimmed.length;
  }, [stations, pins, current, onStationClick]);

  useEffect(() => {
    if (mapRef.current || !boxRef.current) return undefined;
    let map;
    try {
      map = L.map(boxRef.current, {
        zoomControl: true,
        attributionControl: true,
        preferCanvas: true,
        worldCopyJump: true,
        minZoom: 2,
        maxZoom: 18,
        center: start.center,
        zoom: start.zoom,
      });
      L.tileLayer(TILE_URL, {
        maxZoom: 18,
        maxNativeZoom: MAX_NATIVE_ZOOM,
        attribution: ATTRIBUTION,
      }).addTo(map);
      map.attributionControl.setPrefix(false);
    } catch (err) {
      setFailed(true);
      return undefined;
    }
    map.on("moveend zoomend", () => draw());
    map.on("tileerror", () => setFailed(true));
    mapRef.current = map;
    draw();
    // Leaflet measures its container on creation; a late settle fixes a half-drawn map
    // when the panel appears during a layout change.
    const settle = setTimeout(() => {
      try {
        map.invalidateSize();
        draw();
      } catch {
        /* gone */
      }
    }, 350);
    return () => {
      clearTimeout(settle);
      try {
        map.remove();
      } catch {
        /* gone */
      }
      mapRef.current = null;
      layerRef.current = null;
    };
    // Mount once: the map is long-lived, the dots are redrawn by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // New station data, a new playing station, or a new pin set: redraw in place.
  useEffect(() => {
    if (mapRef.current) draw();
  }, [draw]);

  // Follow the playing station when it changes underneath us.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !current || current.lat == null) return;
    try {
      map.panTo([current.lat, current.lng], { animate: true, duration: 0.4 });
    } catch {
      /* gone */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current && current.id]);

  return (
    <div className="absolute inset-0 z-20">
      <div ref={boxRef} className="absolute inset-0" style={{ background: "#05070a" }} />
      {failed && (
        <div className="pointer-events-none absolute left-1/2 top-24 -translate-x-1/2 rounded-full bg-[#0b1114]/90 px-4 py-2 text-xs text-[#ffd9a0] ring-1 ring-[#ffb454]/40">
          Imagery unavailable right now — the globe is still there
        </div>
      )}
      <button
        onClick={onBack}
        className="absolute left-4 top-24 z-[500] rounded-full rm-glass px-4 py-2 text-xs font-500 text-[#eafff4] ring-1 ring-white/10 transition-all hover:bg-[#2fe08a]/15"
      >
        ← Back to the globe
      </button>
    </div>
  );
};

export default DeepMap;
