import { useMemo } from "react";
import * as THREE from "three";
import { ConvexGeometry } from "three/examples/jsm/geometries/ConvexGeometry.js";
import type { PreprocessedPoly } from "../lib/types";

interface Props {
  polys: PreprocessedPoly[];
  visible: boolean;
  opacity: number; // 0.0–1.0
  selectedArea: number | null;
}

const CONVEX_CACHE = new Map<number, THREE.BufferGeometry>();

function convexGeo(poly: PreprocessedPoly): THREE.BufferGeometry | null {
  const n = poly.positions.length / 3;
  if (n < 4) return null;
  if (CONVEX_CACHE.has(poly.id)) return CONVEX_CACHE.get(poly.id)!;
  const vecs: THREE.Vector3[] = [];
  for (let i = 0; i < poly.positions.length; i += 3) {
    vecs.push(new THREE.Vector3(poly.positions[i], poly.positions[i + 1], poly.positions[i + 2]));
  }
  try {
    const geo = new ConvexGeometry(vecs);
    CONVEX_CACHE.set(poly.id, geo);
    return geo;
  } catch {
    return null;
  }
}

/** Transparent ConvexGeometry solid for each polyhedron. */
export function PolyMesh({ polys, visible, opacity, selectedArea }: Props) {
  const items = useMemo(() => polys.map((p) => {
    const geo = convexGeo(p);
    if (!geo) return null;
    const dimmed = selectedArea !== null && selectedArea !== p.areaId;
    return { key: p.id, poly: p, geo, dimmed };
  }).filter(Boolean) as { key: number; poly: PreprocessedPoly; geo: THREE.BufferGeometry; dimmed: boolean }[],
  [polys, selectedArea]);

  if (!visible) return null;

  return (
    <>
      {items.map(({ key, poly, geo, dimmed }) => (
        <mesh key={key} geometry={geo}>
          <meshStandardMaterial
            color={poly.colorHex}
            transparent
            opacity={dimmed ? opacity * 0.2 : opacity}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      ))}
    </>
  );
}
