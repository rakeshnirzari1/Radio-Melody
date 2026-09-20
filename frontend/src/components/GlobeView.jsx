import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import Globe from "react-globe.gl";
import { toast } from "sonner";
import { usePlayer } from "../context/PlayerContext";

const R_EARTH_KM = 6371;

const haversineKm = (lat1, lon1, lat2, lon2) => {
  const p = Math.PI / 180;
  const a =
    0.5 -
    Math.cos((lat2 - lat1) * p) / 2 +
    (Math.cos(lat1 * p) * Math.cos(lat2 * p) * (1 - Math.cos((lon2 - lon1) * p))) / 2;
  return 2 * R_EARTH_KM * Math.asin(Math.sqrt(Math.max(0, a)));
};

const GlobeView = ({ stations, focusStation, userLoc, pins, onStationClick }) => {
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

  useEffect(() => {
    if (!globeRef.current || !focusStation) return;
    if (focusStation.lat == null || focusStation.lng == null) return;
    globeRef.current.controls().autoRotate = false;
    globeRef.current.pointOfView(
      { lat: focusStation.lat, lng: focusStation.lng, altitude: 0.65 },
      1400
    );
  }, [focusStation]);

  const pointsData = useMemo(() => {
    const base = stations || [];
    const pinPts = (pins || [])
      .filter((s) => s.lat != null && s.lng != null)
      .map((s) => ({ ...s, _pin: true }));
    return [...base, ...pinPts];
  }, [stations, pins]);

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
                : "#37f59a"
        }
        pointAltitude={(d) =>
          current && d.id === current.id
            ? 0.06
            : hovered && d.id === hovered.id
              ? 0.05
              : d._pin
                ? 0.02
                : 0.008
        }
        pointRadius={(d) =>
          current && d.id === current.id
            ? 0.55
            : hovered && d.id === hovered.id
              ? 0.65
              : d._pin
                ? 0.42
                : 0.3
        }
        pointResolution={8}
        pointsMerge={false}
        pointLabel={(d) =>
          `<div style="font-family:Inter,sans-serif;background:rgba(5,10,12,0.92);border:1px solid rgba(47,224,138,0.4);color:#e8f0ec;padding:6px 10px;border-radius:8px;font-size:12px;max-width:220px"><b style="color:#7bf0b8">${d.name}</b><br/><span style="opacity:.7">${d.state ? d.state + ", " : ""}${d.country || ""}</span></div>`
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
        ringMaxRadius={(d) => (d.kind === "hover" ? 1.8 : d.kind === "user" ? 5 : 4)}
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
