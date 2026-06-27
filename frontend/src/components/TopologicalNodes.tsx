import { useMemo } from "react";
import type { TopologicalNode } from "../lib/types";

interface Props {
  nodes: TopologicalNode[];
  visible: boolean;
  selectedArea: number | null;
  selectedNodeId: number | null;
  onSelectNode: (id: number | null) => void;
}

const EMPTY = new Float32Array(0);

/** Poly center spheres — first-class renderable graph nodes. */
export function TopologicalNodes({ nodes, visible, selectedArea, selectedNodeId, onSelectNode }: Props) {
  const groups = useMemo(() => {
    const byArea = new Map<number, TopologicalNode[]>();
    for (const n of nodes) {
      const key = n.areaId;
      if (!byArea.has(key)) byArea.set(key, []);
      byArea.get(key)!.push(n);
    }

    return [...byArea.entries()].map(([areaId, ns]) => {
      const pos = new Float32Array(ns.length * 3);
      for (let i = 0; i < ns.length; i++) {
        pos[i * 3] = ns[i].position[0];
        pos[i * 3 + 1] = ns[i].position[1];
        pos[i * 3 + 2] = ns[i].position[2];
      }
      const dimmed = selectedArea !== null && selectedArea !== areaId;
      return { areaId, positions: pos, color: ns[0]?.colorHex ?? "#888", dimmed };
    });
  }, [nodes, selectedArea]);

  if (!visible) return null;

  return (
    <>
      {groups.map(({ areaId, positions, color, dimmed }) => (
        <points key={areaId}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[positions, 3] as [Float32Array, number]} count={positions.length / 3} />
          </bufferGeometry>
          <pointsMaterial
            color={color}
            size={0.12}
            sizeAttenuation
            transparent
            opacity={dimmed ? 0.2 : 0.85}
            depthTest
          />
        </points>
      ))}
      {/* Clickable individual spheres for selected highlight */}
      {nodes.filter((n) => n.id === selectedNodeId).map((n) => (
        <mesh key={`sel-${n.id}`} position={n.position}>
          <sphereGeometry args={[0.18, 12, 8]} />
          <meshBasicMaterial color="#ffaa00" transparent opacity={0.9} />
        </mesh>
      ))}
    </>
  );
}
