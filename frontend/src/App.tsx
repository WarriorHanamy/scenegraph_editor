import { useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import type { SceneGraphSnapshot } from "./lib/types";

function SceneGraph3D({ snapshot }: { snapshot: SceneGraphSnapshot }) {
  return (
    <Canvas style={{ width: "100%", height: "100%" }}>
      <PerspectiveCamera makeDefault position={[15, 10, 15]} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 5]} intensity={0.8} />
      <gridHelper args={[40, 40, "#333", "#222"]} position={[0, -0.5, 0]} />
      <axesHelper args={[2]} />
      <OrbitControls enableDamping dampingFactor={0.1} maxDistance={200} minDistance={0.5} />
    </Canvas>
  );
}

export function App() {
  const [snapshot, setSnapshot] = useState<SceneGraphSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/data/scene_graph.json")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => setSnapshot(data))
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {error && (
        <div style={{
          position: "absolute", top: 16, left: 16, zIndex: 10,
          background: "rgba(200,0,0,0.8)", color: "#fff",
          padding: "8px 16px", borderRadius: 6, fontSize: 13,
        }}>
          {error}
        </div>
      )}
      {snapshot ? (
        <SceneGraph3D snapshot={snapshot} />
      ) : (
        <div style={{
          position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
          color: "#666", fontSize: 14,
        }}>
          Loading scene graph...
        </div>
      )}
    </div>
  );
}
