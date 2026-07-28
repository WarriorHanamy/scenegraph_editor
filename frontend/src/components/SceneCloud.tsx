import { useMemo } from "react";

export function SceneCloud({
  positions,
  visible,
}: {
  positions: Float32Array;
  visible: boolean;
}) {
  const posArray = useMemo(() => positions, [positions]);

  return (
    <points visible={visible} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[posArray, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={1}
        color="#ffffff"
        sizeAttenuation={false}
        transparent
        opacity={0.9}
        depthWrite={false}
      />
    </points>
  );
}
