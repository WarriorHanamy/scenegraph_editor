import { useMemo, useRef } from "react";
import { TransformControls } from "@react-three/drei";
import type { TopologicalNode } from "../lib/types";

interface Props {
  nodes: TopologicalNode[];
  visible: boolean;
  selectedArea: number | null;
  selectedNodeIds: Set<number>;
  hoveredNodeId: number | null;
  editMode: boolean;
  moveNodeId: number | null;
  onNodeMoved: (id: number, pos: [number, number, number]) => void;
}

/**
 * Topological nodes rendered as batch points.
 * Selected nodes get highlight spheres; one node can be moved via TransformControls.
 * Click handling is done by the parent ClickHandler component.
 */
export function TopologicalNodes({
  nodes,
  visible,
  selectedArea,
  selectedNodeIds,
  hoveredNodeId,
  editMode,
  moveNodeId,
  onNodeMoved,
}: Props) {
  const tcRef = useRef<any>(null!);

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

  const selectedNodes = useMemo(
    () => nodes.filter((n) => selectedNodeIds.has(n.id)),
    [nodes, selectedNodeIds],
  );

  const hoveredNode = useMemo(
    () =>
      hoveredNodeId !== null && !selectedNodeIds.has(hoveredNodeId)
        ? nodes.find((n) => n.id === hoveredNodeId) ?? null
        : null,
    [nodes, hoveredNodeId, selectedNodeIds],
  );

  const moveNode = useMemo(
    () => (moveNodeId !== null ? nodes.find((n) => n.id === moveNodeId) : null),
    [nodes, moveNodeId],
  );

  if (!visible) return null;

  return (
    <>
      {/* Batch points */}
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

      {/* Selected node highlights */}
      {selectedNodes.map((n) => (
        <mesh key={`sel-${n.id}`} position={n.position}>
          <sphereGeometry args={[0.2, 16, 10]} />
          <meshBasicMaterial color="#ffaa00" transparent opacity={0.9} depthTest />
        </mesh>
      ))}

      {hoveredNode && (
        <mesh position={hoveredNode.position}>
          <sphereGeometry args={[0.17, 16, 10]} />
          <meshBasicMaterial
            color="#00e5ff"
            transparent
            opacity={0.95}
            depthTest={false}
          />
        </mesh>
      )}

      {/* Move gizmo with TransformControls */}
      {editMode && moveNode && (
        <TransformControls
          ref={tcRef}
          mode="translate"
          position={[moveNode.position[0], moveNode.position[1], moveNode.position[2]]}
          onObjectChange={() => {
            if (tcRef.current) {
              const p = tcRef.current.position;
              onNodeMoved(moveNode.id, [p.x, p.y, p.z]);
            }
          }}
        />
      )}
    </>
  );
}
