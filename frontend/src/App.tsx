import { useEffect, useState, useMemo, useCallback } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { PointCloudObject } from "./components/PointCloudObject";
import { AreaBox } from "./components/AreaBoxes";
import { AreaEdges } from "./components/AreaEdges";
import { AreaCenters } from "./components/AreaCenters";
import { PolyhedraAll } from "./components/PolyhedraAll";
import { PolyMesh } from "./components/PolyMesh";
import { TopologicalNodes } from "./components/TopologicalNodes";
import { TopologicalEdges } from "./components/TopologicalEdges";
import { ObjectPolyEdges } from "./components/ObjectPolyEdges";
import { WorldAxes } from "./components/WorldAxes";
import { loadSceneBin } from "./lib/scene-loader";
import type { SceneData } from "./lib/types";

interface Layers {
  objects: boolean;
  areas: boolean;
  areaEdges: boolean;
  areaCenters: boolean;
  polyPoints: boolean;
  polyWireframe: boolean;
  polyMesh: boolean;
  topoNodes: boolean;
  topoEdges: boolean;
  objPolyEdges: boolean;
}

type LayerKey = keyof Layers;

function Scene({
  data, layers, selectedArea, selectedNodeId, onSelectNode, meshOpacity,
}: {
  data: SceneData; layers: Layers; selectedArea: number | null;
  selectedNodeId: number | null; onSelectNode: (id: number | null) => void;
  meshOpacity: number;
}) {
  const objects = useMemo(() =>
    data.objects.map((obj) => <PointCloudObject key={obj.id} obj={obj} visible={layers.objects} />),
  [data, layers.objects]);

  const areaBoxes = useMemo(() =>
    data.areas.map((a) => <AreaBox key={a.id} area={a} visible={layers.areas} selected={a.id === selectedArea} />),
  [data, layers.areas, selectedArea]);

  return (
    <Canvas style={{ width: "100%", height: "100%" }}>
      <PerspectiveCamera makeDefault position={[12, 25, 20]} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 15, 5]} intensity={1.2} />

      <group rotation={[-Math.PI / 2, 0, 0]}>
        <WorldAxes />
        {objects}
        {areaBoxes}
        {layers.areaEdges && <AreaEdges areas={data.areas} visible />}
        {layers.areaCenters && <AreaCenters areas={data.areas} visible />}
        {(layers.polyPoints || layers.polyWireframe) && (
          <PolyhedraAll data={data} visible={layers.polyPoints} showWireframe={layers.polyWireframe} selectedArea={selectedArea} />
        )}
        {layers.polyMesh && <PolyMesh polys={data.polys} visible opacity={meshOpacity} selectedArea={selectedArea} />}
        {layers.topoEdges && <TopologicalEdges edges={data.topoEdges} visible selectedArea={selectedArea} />}
        {layers.topoNodes && (
          <TopologicalNodes nodes={data.topoNodes} visible selectedArea={selectedArea} selectedNodeId={selectedNodeId} onSelectNode={onSelectNode} />
        )}
        {layers.objPolyEdges && <ObjectPolyEdges data={data} visible />}
      </group>

      <gridHelper args={[80, 80, "#333", "#222"]} />
      <OrbitControls enableDamping dampingFactor={0.1} maxDistance={400} minDistance={1} />
    </Canvas>
  );
}

export function App() {
  const [data, setData] = useState<SceneData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [layers, setLayers] = useState<Layers>({
    objects: false, areas: true, areaEdges: false, areaCenters: false,
    polyPoints: false, polyWireframe: false, polyMesh: true,
    topoNodes: true, topoEdges: true, objPolyEdges: false,
  });
  const [selectedArea, setSelectedArea] = useState<number | null>(null);
  const [selectedNodeId] = useState<number | null>(null);
  const [meshOpacity, setMeshOpacity] = useState(0.10);

  useEffect(() => {
    loadSceneBin("/data/scene.bin")
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  const toggle = useCallback((key: LayerKey) => {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {error && <ErrorBanner msg={error} />}

      {data && (
        <>
          {/* Layer toggles — right side */}
          <div style={{ position: "absolute", top: 16, right: 16, zIndex: 10,
            background: "rgba(0,0,0,0.82)", borderRadius: 8, padding: "12px 16px",
            color: "#ccc", fontFamily: "monospace", fontSize: 12, minWidth: 200, userSelect: "none" }}>
            <div style={{ color: "#fff", fontWeight: 600, marginBottom: 8, fontSize: 13 }}>Layers</div>

            <Toggle label="Object Clouds" k="objects" layers={layers} toggle={toggle} />
            <Toggle label="Area Boxes" k="areas" layers={layers} toggle={toggle} />
            <Toggle label="Area Edges" k="areaEdges" layers={layers} toggle={toggle} />
            <Toggle label="Area Centers" k="areaCenters" layers={layers} toggle={toggle} />

            <div style={{ margin: "6px 0 4px", borderTop: "1px solid #333" }} />
            <div style={{ fontSize: 10, color: "#888", marginBottom: 2 }}>Polyhedra</div>
            <Toggle label="Poly Points" k="polyPoints" layers={layers} toggle={toggle} />
            <Toggle label="Poly Wireframe" k="polyWireframe" layers={layers} toggle={toggle} />
            <Toggle label="Poly Mesh" k="polyMesh" layers={layers} toggle={toggle} />
            {layers.polyMesh && (
              <div style={{ paddingLeft: 20, marginTop: 2, marginBottom: 4 }}>
                <input type="range" min={1} max={100} value={Math.round(meshOpacity * 100)}
                  onChange={(e) => setMeshOpacity(Number(e.target.value) / 100)}
                  style={{ width: "100%", accentColor: "#3498db", height: 4 }} />
                <span style={{ fontSize: 10, color: "#888" }}>{Math.round(meshOpacity * 100)}%</span>
              </div>
            )}

            <div style={{ margin: "6px 0 4px", borderTop: "1px solid #333" }} />
            <div style={{ fontSize: 10, color: "#888", marginBottom: 2 }}>Topology Graph</div>
            <Toggle label="Topo Nodes" k="topoNodes" layers={layers} toggle={toggle} />
            <Toggle label="Topo Edges" k="topoEdges" layers={layers} toggle={toggle} />

            <div style={{ margin: "6px 0 4px", borderTop: "1px solid #333" }} />
            <Toggle label="Obj→Poly Edges" k="objPolyEdges" layers={layers} toggle={toggle} />
          </div>

          {/* Area list — bottom-left */}
          <div style={{ position: "absolute", bottom: 16, left: 16, zIndex: 10,
            background: "rgba(0,0,0,0.75)", borderRadius: 8, padding: "10px 14px",
            color: "#ccc", fontFamily: "monospace", fontSize: 12,
            maxHeight: "40vh", overflowY: "auto", minWidth: 170 }}>
            <div style={{ color: "#fff", fontWeight: 600, marginBottom: 6, fontSize: 13 }}>
              Areas ({data.areas.length})
            </div>
            {data.areas.map((a) => (
              <div key={a.id} onClick={() => setSelectedArea(a.id === selectedArea ? null : a.id)}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 4px",
                  cursor: "pointer", borderRadius: 4,
                  background: a.id === selectedArea ? "rgba(255,255,255,0.1)" : "transparent" }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, flexShrink: 0,
                  backgroundColor: a.colorHex, border: "1px solid rgba(255,255,255,0.15)" }} />
                <span>{a.roomLabel || `A${a.id}`}</span>
                <span style={{ color: "#666", marginLeft: "auto", fontSize: 10 }}>
                  {a.polyIds.length}p
                </span>
              </div>
            ))}
          </div>

          {/* Objects — top-left */}
          <div style={{ position: "absolute", top: 16, left: 16, zIndex: 10,
            background: "rgba(0,0,0,0.75)", borderRadius: 8, padding: "10px 14px",
            color: "#ccc", fontFamily: "monospace", fontSize: 12, minWidth: 160 }}>
            <div style={{ color: "#fff", fontWeight: 600, marginBottom: 6, fontSize: 13 }}>
              Objects ({data.objects.length})
            </div>
            {data.objects.map((obj) => (
              <div key={obj.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0" }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, flexShrink: 0,
                  backgroundColor: obj.colorHex, border: "1px solid rgba(255,255,255,0.15)" }} />
                <span>{obj.label} [{obj.id}]</span>
                <span style={{ color: "#666", marginLeft: "auto", fontSize: 10 }}>{obj.pointCount}pts</span>
              </div>
            ))}
          </div>

          {/* Stats — bottom-right */}
          <div style={{ position: "absolute", bottom: 16, right: 16, zIndex: 10,
            background: "rgba(0,0,0,0.6)", borderRadius: 6, padding: "6px 12px",
            color: "#888", fontFamily: "monospace", fontSize: 11 }}>
            Polys: {data.polys.length} &middot; Nodes: {data.topoNodes.length} &middot; TopoEdges: {data.topoEdges.length}
          </div>
        </>
      )}

      {data ? (
        <Scene data={data} layers={layers} selectedArea={selectedArea} selectedNodeId={selectedNodeId} onSelectNode={() => {}} meshOpacity={meshOpacity} />
      ) : loading ? (
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
          color: "#666", fontSize: 14, fontFamily: "monospace" }}>Loading...</div>
      ) : null}
    </div>
  );
}

function Toggle({ label, k, layers, toggle }: {
  label: string; k: LayerKey; layers: Layers; toggle: (k: LayerKey) => void;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0", cursor: "pointer" }}>
      <input type="checkbox" checked={layers[k]} onChange={() => toggle(k)} style={{ accentColor: "#3498db" }} />
      <span>{label}</span>
    </label>
  );
}

function ErrorBanner({ msg }: { msg: string }) {
  return (
    <div style={{ position: "absolute", top: 16, left: 16, zIndex: 10,
      background: "rgba(200,0,0,0.85)", color: "#fff", padding: "8px 16px",
      borderRadius: 6, fontSize: 13, fontFamily: "monospace" }}>{msg}</div>
  );
}
