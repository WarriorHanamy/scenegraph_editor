import { useMemo } from "react";
import type { TopologicalEdge } from "../lib/types";

interface Props {
  edges: TopologicalEdge[];
  visible: boolean;
  selectedArea: number | null;
}

const EMPTY = new Float32Array(0);

/**
 * Inter-node adjacency lines with vertexColors.
 * Cross-area edges get gradient colors from src area → dst area.
 * Same-area edges are solid color (both ends same).
 */
export function TopologicalEdges({ edges, visible, selectedArea }: Props) {
  const lines = useMemo(() => {
    const filtered = selectedArea === null
      ? edges
      : edges.filter((e) => {
          return e.srcColorHex === e.dstColorHex
            ? true // same-area — show all
            : true; // cross-area — still show (could filter by selectedArea if desired)
        });

    const pos = new Float32Array(filtered.length * 2 * 3);
    const col = new Float32Array(filtered.length * 2 * 3);

    for (let i = 0; i < filtered.length; i++) {
      const e = filtered[i];
      const bo = i * 6;
      pos[bo] = e.srcPos[0]; pos[bo + 1] = e.srcPos[1]; pos[bo + 2] = e.srcPos[2];
      pos[bo + 3] = e.dstPos[0]; pos[bo + 4] = e.dstPos[1]; pos[bo + 5] = e.dstPos[2];

      const [sR, sG, sB] = hexRgb(e.srcColorHex);
      const [dR, dG, dB] = hexRgb(e.dstColorHex);
      col[bo] = sR; col[bo + 1] = sG; col[bo + 2] = sB;
      col[bo + 3] = dR; col[bo + 4] = dG; col[bo + 5] = dB;
    }
    return { positions: pos, colors: col, count: filtered.length * 2 };
  }, [edges, selectedArea]);

  if (!visible || lines.count === 0) return null;

  return (
    <lineSegments>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[lines.positions, 3] as [Float32Array, number]} count={lines.count} />
        <bufferAttribute attach="attributes-color" args={[lines.colors, 3] as [Float32Array, number]} count={lines.count} />
      </bufferGeometry>
      <lineBasicMaterial vertexColors transparent opacity={selectedArea !== null ? 0.25 : 0.45} linewidth={1} />
    </lineSegments>
  );
}

function hexRgb(h: string): [number, number, number] {
  const v = parseInt(h.slice(1), 16);
  return [((v >> 16) & 0xff) / 255, ((v >> 8) & 0xff) / 255, (v & 0xff) / 255];
}
