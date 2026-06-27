import { useEffect, useState, useMemo, useCallback } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera, Html } from "@react-three/drei";
import { PointCloudObject } from "./components/PointCloudObject";
import { AreaBox } from "./components/AreaBoxes";
import { AreaEdges } from "./components/AreaEdges";
import { AreaCenters } from "./components/AreaCenters";
import { loadSceneBin } from "./lib/scene-loader";
import type { SceneData } from "./lib/types";

interface Layers {
  objects: boolean;
  areas: boolean;
  edges: boolean;
  centers: boolean;
}

function Scene({ data, layers, selectedArea }: { data: SceneData; layers: Layers; selectedArea: number | null }) {
  const visibleObjIds = useMemo(() => new Set(data.objects.map((o) => o.id)), [data]);

  const objects = useMemo(
    () => data.objects.map((obj) => (
      <PointCloudObject key={obj.id} obj={obj} visible={layers.objects} />
    )),
    [data, layers.objects],
  );

  const areaBoxes = useMemo(
    () => data.areas.map((a) => (
      <AreaBox key={a.id} area={a} visible={layers.areas} selected={a.id === selectedArea} />
    )),
    [data, layers.areas, selectedArea],
  );

  return (
    <Canvas style={{ width: "100%", height: "100%" }}>
      <PerspectiveCamera makeDefault position={[15, 20, 25]} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 10, 5]} intensity={0.8} />
      <gridHelper args={[60, 60, "#333", "#222"]} position={[0, -10, 0]} />
      <axesHelper args={[2]} />
      {objects}
      {areaBoxes}
      {layers.edges && <AreaEdges areas={data.areas} visible={true} />}
      {layers.centers && <AreaCenters areas={data.areas} visible={true} />}
      <OrbitControls enableDamping dampingFactor={0.1} maxDistance={200} minDistance={1} />
    </Canvas>
  );
}

export function App() {
  const [data, setData] = useState<SceneData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [layers, setLayers] = useState<Layers>({ objects: true, areas: true, edges: true, centers: true });
  const [selectedArea, setSelectedArea] = useState<number | null>(null);

  useEffect(() => {
    loadSceneBin("/data/scene.bin")
      .then((d) => setData(d))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  const toggle = useCallback((key: keyof Layers) => {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {error && (
        <div style={{
          position: "absolute", top: 16, left: 16, zIndex: 10,
          background: "rgba(200,0,0,0.85)", color: "#fff",
          padding: "8px 16px", borderRadius: 6, fontSize: 13, fontFamily: "monospace",
        }}>
          {error}
        </div>
      )}

      {data && (
        <>
          {/* Layer toggles */}
          <div style={{
            position: "absolute", top: 16, right: 16, zIndex: 10,
            background: "rgba(0,0,0,0.78)", borderRadius: 8,
            padding: "10px 14px", color: "#ccc",
            fontFamily: "monospace", fontSize: 12,
            minWidth: 170, userSelect: "none",
          }}>
            <div style={{ color: "#fff", fontWeight: 600, marginBottom: 8, fontSize: 13 }}>Layers</div>
            <LayerToggle label="Point Clouds"   checked={layers.objects}  onChange={() => toggle("objects")}  />
            <LayerToggle label="Area Boxes"     checked={layers.areas}    onChange={() => toggle("areas")}    />
            <LayerToggle label="Area Edges"     checked={layers.edges}    onChange={() => toggle("edges")}    />
            <LayerToggle label="Area Centers"   checked={layers.centers}  onChange={() => toggle("centers")}  />
          </div>

          {/* Object list */}
          <div style={{
            position: "absolute", top: 16, left: 16, zIndex: 10,
            background: "rgba(0,0,0,0.75)", borderRadius: 8,
            padding: "10px 14px", color: "#ccc",
            fontFamily: "monospace", fontSize: 12,
            minWidth: 160,
          }}>
            <div style={{ color: "#fff", fontWeight: 600, marginBottom: 6, fontSize: 13 }}>
              Objects ({data.objects.length})
            </div>
            {data.objects.map((obj) => (
              <div key={obj.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0" }}>
                <span style={{
                  width: 10, height: 10, borderRadius: 2, flexShrink: 0,
                  backgroundColor: obj.colorHex, border: "1px solid rgba(255,255,255,0.15)",
                }} />
                <span>{obj.label} [{obj.id}]</span>
                <span style={{ color: "#666", marginLeft: "auto", fontSize: 10 }}>{obj.pointCount}pts</span>
              </div>
            ))}
          </div>

          {/* Area list */}
          <div style={{
            position: "absolute", bottom: 16, left: 16, zIndex: 10,
            background: "rgba(0,0,0,0.75)", borderRadius: 8,
            padding: "10px 14px", color: "#ccc",
            fontFamily: "monospace", fontSize: 12,
            maxHeight: "45vh", overflowY: "auto",
            minWidth: 160,
          }}>
            <div style={{ color: "#fff", fontWeight: 600, marginBottom: 6, fontSize: 13 }}>
              Areas ({data.areas.length})
            </div>
            {data.areas.map((a) => (
              <div
                key={a.id}
                onClick={() => setSelectedArea(a.id === selectedArea ? null : a.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "2px 4px", cursor: "pointer", borderRadius: 4,
                  background: a.id === selectedArea ? "rgba(255,255,255,0.1)" : "transparent",
                }}
              >
                <span style={{
                  width: 10, height: 10, borderRadius: 2, flexShrink: 0,
                  backgroundColor: a.colorHex, border: "1px solid rgba(255,255,255,0.15)",
                }} />
                <span>{a.roomLabel} [{a.id}]</span>
                <span style={{ color: "#666", marginLeft: "auto", fontSize: 10 }}>
                  {a.neighborIds.length}n
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {data ? (
        <Scene data={data} layers={layers} selectedArea={selectedArea} />
      ) : loading ? (
        <div style={{
          position: "absolute", top: "50%", left: "50%",
          transform: "translate(-50%,-50%)",
          color: "#666", fontSize: 14, fontFamily: "monospace",
        }}>
          Loading...
        </div>
      ) : null}
    </div>
  );
}

function LayerToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0", cursor: "pointer" }}>
      <input type="checkbox" checked={checked} onChange={onChange} style={{ accentColor: "#3498db" }} />
      <span>{label}</span>
    </label>
  );
}
