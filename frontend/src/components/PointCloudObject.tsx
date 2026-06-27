import { useMemo, useRef } from "react";
import type { PreprocessedObject } from "../lib/types";

interface Props {
  obj: PreprocessedObject;
  visible: boolean;
}

export function PointCloudObject({ obj, visible }: Props) {
  const ref = useRef<any>(null);

  const posAttr = useMemo(() => {
    return { array: obj.positions, itemSize: 3, count: obj.pointCount };
  }, [obj.positions, obj.pointCount]);

  const colAttr = useMemo(() => {
    return { array: obj.colors, itemSize: 3, count: obj.pointCount };
  }, [obj.colors, obj.pointCount]);

  if (!visible) return null;

  return (
    <points ref={ref} visible={visible}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[posAttr.array, posAttr.itemSize] as [Float32Array, number]}
          count={posAttr.count}
        />
        <bufferAttribute
          attach="attributes-color"
          args={[colAttr.array, colAttr.itemSize] as [Float32Array, number]}
          count={colAttr.count}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.04}
        vertexColors
        sizeAttenuation
        depthWrite
        transparent={false}
      />
    </points>
  );
}
