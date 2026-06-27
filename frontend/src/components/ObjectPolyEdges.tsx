import { useMemo } from "react";
import type { SceneData } from "../lib/types";

interface Props {
  data: SceneData;
  visible: boolean;
}

/**
 * Dashed lines from each object's center to its father polyhedron's center.
 * Uses vertex colors so intra-area edges have solid color,
 * inter-area (if applicable) would gradient.
 */
export function ObjectPolyEdges({ data, visible }: Props) {
  if (!visible) return null;

  const lines = useMemo(() => {
    const result: { positions: Float32Array; colors: Float32Array; key: string }[] = [];
    const polyMap = new Map<number, { center: [number, number, number]; colorHex: string }>();
    for (const p of data.polys) {
      polyMap.set(p.id, { center: p.center, colorHex: p.colorHex });
    }

    for (const obj of data.objects) {
      const poly = polyMap.get(obj.fatherPolyId);
      if (!poly) continue;

      const objRgb = hexToRgb(obj.colorHex);
      const polyRgb = hexToRgb(poly.colorHex);

      const pos = new Float32Array(6); // 2 points × 3
      pos[0] = obj.center[0]; pos[1] = obj.center[1]; pos[2] = obj.center[2];
      pos[3] = poly.center[0]; pos[4] = poly.center[1]; pos[5] = poly.center[2];

      const col = new Float32Array(6); // gradient: obj color → poly color
      col[0] = objRgb[0]; col[1] = objRgb[1]; col[2] = objRgb[2];
      col[3] = polyRgb[0]; col[4] = polyRgb[1]; col[5] = polyRgb[2];

      result.push({ positions: pos, colors: col, key: `obj${obj.id}-poly${polyMap.get(obj.fatherPolyId)}` });
    }
    return result;
  }, [data]);

  return (
    <>
      {lines.map(({ positions, colors, key }) => (
        <line key={key}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[positions, 3] as [Float32Array, number]}
              count={2}
            />
            <bufferAttribute
              attach="attributes-color"
              args={[colors, 3] as [Float32Array, number]}
              count={2}
            />
          </bufferGeometry>
          <lineBasicMaterial vertexColors linewidth={1} transparent opacity={0.6} />
        </line>
      ))}
    </>
  );
}

function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [((v >> 16) & 0xff) / 255, ((v >> 8) & 0xff) / 255, (v & 0xff) / 255];
}
