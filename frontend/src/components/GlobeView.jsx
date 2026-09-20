import React, { useEffect, useRef, useState, useMemo } from "react";
import Globe from "react-globe.gl";
import { usePlayer } from "../context/PlayerContext";

const GlobeView = ({ stations, focusStation, userLoc, onStationClick }) => {
  const globeRef = useRef();
  const wrapRef = useRef();
  const { current } = usePlayer();
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [ready, setReady] = useState(false);

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

  const pointsData = useMemo(() => stations || [], [stations]);

  const ringsData = useMemo(() => {
    const rings = [];
    if (current && current.lat != null)
      rings.push({ lat: current.lat, lng: current.lng, kind: "station" });
    if (userLoc)
      rings.push({ lat: userLoc.lat, lng: userLoc.lng, kind: "user" });
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
        globeImageUrl="//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
        bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
        showAtmosphere={true}
        atmosphereColor="#7fd4ff"
        atmosphereAltitude={0.2}
        pointsData={pointsData}
        pointLat="lat"
        pointLng="lng"
        pointColor={(d) =>
          current && d.id === current.id ? "#ffffff" : "#37f59a"
        }
        pointAltitude={(d) => (current && d.id === current.id ? 0.06 : 0.008)}
        pointRadius={(d) => (current && d.id === current.id ? 0.5 : 0.26)}
        pointResolution={6}
        pointsMerge={false}
        pointLabel={(d) =>
          `<div style="font-family:Inter,sans-serif;background:rgba(5,10,12,0.92);border:1px solid rgba(47,224,138,0.4);color:#e8f0ec;padding:6px 10px;border-radius:8px;font-size:12px;max-width:220px"><b style="color:#7bf0b8">${d.name}</b><br/><span style="opacity:.7">${d.state ? d.state + ", " : ""}${d.country || ""}</span></div>`
        }
        onPointClick={(d) => onStationClick && onStationClick(d)}
        ringsData={ringsData}
        ringColor={(d) =>
          d.kind === "user"
            ? (t) => `rgba(127,212,255,${1 - t})`
            : (t) => `rgba(55,245,154,${1 - t})`
        }
        ringMaxRadius={(d) => (d.kind === "user" ? 5 : 4)}
        ringPropagationSpeed={3}
        ringRepeatPeriod={900}
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
