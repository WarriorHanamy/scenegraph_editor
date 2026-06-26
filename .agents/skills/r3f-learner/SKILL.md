---
name: r3f-learner
description: Core React Three Fiber (R3F) patterns for Scene Graph Editor — Canvas setup, PCD point-cloud rendering, scene-graph visualization (area boxes + edges), drei helpers, and data-to-3D flow. Use when writing or reviewing 3D scene components for scene graph snapshots.
---

# React Three Fiber Learner

## 1. Three.js → R3F Component Mapping

| Three.js API                | R3F Component         | Notes                                  |
| --------------------------- | --------------------- | -------------------------------------- |
| `THREE.Mesh`                | `<mesh>`              | Default geometry + material container  |
| `THREE.Mesh` + BoxGeometry  | `<mesh><boxGeometry args={[1,1,1]} /><meshBasicMaterial color="red" /></mesh>` | Geometries and materials are children |
| `THREE.BufferGeometry`      | `<bufferGeometry>`    | For custom vertex data                 |
| `THREE.Points`              | `<points>`            | With `<bufferGeometry>` + `<pointsMaterial>` |
| `THREE.Line`                | `<Line>` (from drei)  | Prefer drei `<Line>` over raw `<line>` |
| `THREE.LineSegments`        | `<lineSegments>`      | For wireframe / edge sets              |
| `THREE.PerspectiveCamera`   | `<PerspectiveCamera>` | Use `makeDefault` to override Canvas's default |
| `THREE.Scene`               | `<Canvas>`            | Root container, auto-creates scene     |
| `THREE.AmbientLight`        | `<ambientLight>`      | lowercase camelCase                    |
| `THREE.DirectionalLight`    | `<directionalLight>`  | lowercase camelCase                    |
| `THREE.AxesHelper`          | `<axesHelper>`        | `args={[size]}`                        |
| `THREE.GridHelper`          | `<gridHelper>`        | `args={[size, divisions, colorCenter, colorGrid]}`  |
| `THREE.OrbitControls`       | `<OrbitControls>` (drei) | With `enableDamping` for smooth pan  |
| `THREE.Scene.add(object)`   | JSX child placement    | Parent-child in JSX tree = scene graph |

## 2. Scene Graph Data Types

```typescript
interface Area {
  id: number;
  room_label: string;
  room_description: string;
  box_min: [number, number, number];
  box_max: [number, number, number];
  center: [number, number, number];
  color: [number, number, number];
  neighbor_area_ids: number[];
  object_ids: number[];
}

interface Object3DData {
  id: number;
  label: string;
  position: [number, number, number];
  color: [number, number, number];
  cloud_path: string;
  edge: {
    father_object_id: number;
    child_object_ids: number[];
    edge_description: string;
  };
}

interface SceneGraphSnapshot {
  areas: Area[];
  objects: Object3DData[];
  polyhedrons: Array<{ id: number; center: [number,number,number]; object_ids: number[] }>;
  counters: { area_count: number; object_count: number };
}
```

## 3. Canvas Setup (Project Standard)

```tsx
import { Canvas } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera } from "@react-three/drei";

function Scene() {
  return (
    <Canvas style={{ width: "100%", height: "100%" }}>
      <PerspectiveCamera makeDefault position={[15, 10, 15]} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 5]} intensity={0.8} />
      <OrbitControls
        enableDamping
        dampingFactor={0.1}
        maxDistance={200}
        minDistance={0.5}
      />
    </Canvas>
  );
}
```

Rules:
- Canvas at 100% viewport (no fixed pixel size)
- `makeDefault` on `PerspectiveCamera` replaces Canvas's default camera
- OrbitControls always with `enableDamping` in this project
- No `<Suspense>` wrapping (no loaded assets yet)
- No `gl` props on Canvas (use defaults)

## 4. Point Cloud (PCD) Rendering

### PCD Format (ASCII/header)

```text
VERSION 0.7
FIELDS x y z rgb
SIZE 4 4 4 4
TYPE F F F F
COUNT 1 1 1 1
WIDTH <n>
HEIGHT 1
VIEWPOINT 0 0 0 1 0 0 0
POINTS <n>
DATA ascii
x0 y0 z0 rgb0
x1 y1 z1 rgb1
...
```

### PCD → Three.js Points (custom loader)

```tsx
import { useMemo } from "react";

function parsePCD(text: string): Float32Array {
  const lines = text.trim().split("\n");
  const dataStart = lines.findIndex((l) => l.startsWith("DATA "));
  const header = lines.slice(0, dataStart);
  const dataLines = lines.slice(dataStart + 1);

  const fields = header
    .find((l) => l.startsWith("FIELDS"))!
    .split(/\s+/)
    .slice(1);
  const hasRgb = fields.includes("rgb");

  const positions: number[] = [];
  const colors: number[] = [];

  for (const line of dataLines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;
    positions.push(parseFloat(parts[0]), parseFloat(parts[1]), parseFloat(parts[2]));
    if (hasRgb && parts.length >= 4) {
      const rgb = parseInt(parts[3]);
      colors.push(((rgb >> 16) & 0xff) / 255, ((rgb >> 8) & 0xff) / 255, (rgb & 0xff) / 255);
    }
  }

  const arr = new Float32Array(positions.length + (hasRgb ? colors.length : 0));
  arr.set(positions, 0);
  if (hasRgb) arr.set(colors, positions.length);
  return arr; // [x,y,z,...] then [r,g,b,...] if hasRgb
}

function PointCloud({ url }: { url: string }) {
  const [data, setData] = useState<Float32Array | null>(null);
  useEffect(() => {
    fetch(url).then((r) => r.text()).then((t) => setData(parsePCD(t)));
  }, [url]);

  if (!data) return null;

  // Positions at start, colors at offset
  const posCount = Math.floor(data.length / (3 + 3)); // naive; use header to know
  // Better: pass parsed result with separate arrays
  const positions = data.subarray(0, posCount * 3);
  const colors = data.subarray(posCount * 3);

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={positions.length / 3}
          array={positions}
          itemSize={3}
        />
        {colors.length > 0 && (
          <bufferAttribute
            attach="attributes-color"
            count={colors.length / 3}
            array={colors}
            itemSize={3}
          />
        )}
      </bufferGeometry>
      <pointsMaterial size={0.02} vertexColors={colors.length > 0} sizeAttenuation />
    </points>
  );
}
```

### MeshLab PCD variation (x y z nx ny nz)

If PCD file contains normals instead of rgb:

```text
FIELDS x y z nx ny nz
```

Parse positions only (skip normals), assign uniform color.

## 5. Declarative Props

R3F accepts Three.js properties as JSX attributes with smart auto-conversion:

```tsx
// Arrays → THREE.Vector3 / THREE.Color
<mesh position={[1, 0, 0]} rotation={[0, Math.PI / 2, 0]} scale={1.5} />

// Colors → THREE.Color (string, hex, array)
<meshStandardMaterial color="#ff6b6b" />

// Constructor args use `args` prop
<sphereGeometry args={[radius, widthSeg, heightSeg]} />

// Named props = setter calls
<mesh visible={false} castShadow />
```

Rules:
- `position`, `scale`: use array literal `[x, y, z]`
- `color`: use CSS hex string `"#ff6b6b"` (matching project COLORS array)
- `rotation`: radians, array `[x, y, z]`
- Constructor arguments always in `args={[...]}` prop

## 6. Drei Helpers (Currently Used)

| Import                  | Component              | Project usage                    |
| ----------------------- | ---------------------- | -------------------------------- |
| `@react-three/drei`     | `<OrbitControls>`      | Camera control with damping      |
| `@react-three/drei`     | `<PerspectiveCamera>`  | Declarative camera setup         |
| `@react-three/drei`     | `<Line>`               | Graph edges (area connections, object hierarchy) |
| `@react-three/drei`     | `<Text>`               | 3D labels for areas/objects      |

### `Line` Usage (Graph Edge pattern)

```tsx
import { Line } from "@react-three/drei";
import { useMemo } from "react";

function GraphEdge({ from, to, color, dashed }: Props) {
  const pts = useMemo(
    () => [[from[0], from[1], from[2]] as [number, number, number],
           [to[0], to[1], to[2]] as [number, number, number]],
    [from, to],
  );

  return (
    <Line
      points={pts}
      color={color}
      lineWidth={1}
      transparent
      opacity={0.6}
      dashed={dashed}
      dashSize={0.1}
      gapSize={0.05}
    />
  );
}
```

`Line` from drei is preferred over raw `<line>` because:
- Auto-creates `THREE.BufferGeometry` from array points
- Supports color, opacity, lineWidth uniformly
- Built-in dashed-line support
- No manual geometry/attribute setup needed

### Additional Drei Components for Future Use

| Component          | Purpose                              | Import                     |
| ------------------ | ------------------------------------ | -------------------------- |
| `<Html>`           | Overlay DOM elements in 3D space     | `@react-three/drei`        |
| `<GizmoHelper>`    | Viewport orientation gizmo           | `@react-three/drei`        |
| `<Stats>`          | FPS/performance overlay              | `@react-three/drei`        |
| `<Grid>`           | Infinite grid (v9+)                  | `@react-three/drei`        |
| `<Float>`          | Floating animation helper            | `@react-three/drei`        |
| `<TransformControls>` | Interactive transform manipulator | `@react-three/drei`        |

## 7. Data → 3D Flow

This project uses **props-driven** rendering (not `useFrame`):

```
Fetch scene_graph.json + PCD files → React state (SceneGraphSnapshot)
    → <SceneGraph3D areas={areas} objects={objects}>
    → <AreaBox> (one per area, AABB wireframe)
    → <AreaEdge> (one per neighbor connection)
    → <ObjectCloud> (one per object, PCD points)
    → <ObjectLabel> (3D text at object position)
    → <ObjectEdge> (parent/child hierarchy lines)
```

Rules:
- **State lives in App.tsx**, passed down as props to SceneGraph3D
- **`useMemo` guards re-renders** at every level
- **No `useFrame`** needed — all updates come from React state changes
- **No `useThree`** in current patterns (but can use in future for imperative access)

### When to use props-driven vs useFrame

| Pattern            | When to use                                  |
| ------------------ | -------------------------------------------- |
| Props-driven       | Data comes from external source (fetch, React state) |
| `useFrame`         | Continuous animation (rotation oscillation, particle systems)   |
| `useThree`         | Need access to camera, renderer, or scene imperatively          |

## 8. Performance Rules

1. **PCD size limit** — cap points at ~200K per cloud; downsample if needed
2. **useMemo at every level** — mapping data to R3F elements should be memoized
3. **Prefer drei `<Line>` over raw `<line>`** — fewer draw calls for multi-segment lines
4. **Avoid inline functions in render** — use `useMemo`/`useCallback` for children
5. **No re-create geometries per frame** — if using `useFrame`, mutate attributes in-place
6. **Color is a string prop on MeshStandardMaterial** — React reconciler handles disposal
7. **`transparent + opacity` is acceptable** — this project uses it sparsely

## 9. Common Pitfalls

| Mistake                                         | Fix                                                       |
| ----------------------------------------------- | --------------------------------------------------------- |
| R3F component outside `<Canvas>`                | All `<mesh>`, `<Line>`, `<ambientLight>` must be inside `<Canvas>` |
| `NaN` or `Infinity` in position array            | Validate/filter before passing — Three.js won't error, just blank |
| Missing `key` prop in mapped R3F elements       | Add `key={area.id}` — R3F uses React reconciler to reuse objects |
| `useLoader` without `<Suspense>`                 | Wrap Canvas content in `<Suspense fallback={null}>`       |
| Mutating R3F props without new reference         | R3F uses shallow comparison — spread or new array/object  |
| Import from `three` instead of `@react-three/*`  | Use `@react-three/fiber` for components, `@react-three/drei` for helpers |
| Inline `position={new THREE.Vector3(...)}`      | Use array: `position={[x, y, z]}` (R3F auto-converts)    |
| Not handling missing PCD files                   | Check file existence; show placeholder sphere if missing  |
| PCD with normals instead of rgb                  | Detect header FIELDS; skip normal columns in parser       |

## 10. Project Conventions

- **Coordinate system**: Y-up (Three.js default)
- **Grid**: 40×40, center color `#333`, grid color `#222`, at y=-0.5
- **Axes**: 2-unit length
- **Camera default**: position [15, 10, 15], lookAt origin
- **Area colors**: use scene_graph.json `color` field, convert from [0-1] float to hex string
- **Object cloud color**: use PCD vertex colors if available, else use object color from JSON
- **Color format**: CSS hex strings (`"#ff6b6b"`)
- **Package**: all imports from `@react-three/fiber` and `@react-three/drei` (not raw `three`)
- **No TypeScript path aliases** — relative imports everywhere
- **Class components**: never — function components only with hooks
