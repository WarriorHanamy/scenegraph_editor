import { useEffect, useState, useMemo, useCallback } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
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
import { EditToolbar } from "./components/EditToolbar";
import { loadSceneBin } from "./lib/scene-loader";
import {
  emptyMutations,
  mutationCount,
  edgeKey,
  addDeletePoly,
  addMovePoly,
  addRemoveEdge,
  addAddEdge,
  addCreatePoly,
} from "./lib/mutations";
import type {
  SceneData,
  TopologicalNode,
  TopologicalEdge,
  Mutations,
  EditMode,
  ExportResponse,
} from "./lib/types";

// ---- layers ----

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

// ---- temp poly for rendering ----

interface TempPoly {
  id: number;
  areaId: number;
  position: [number, number, number];
  size: number;
  colorHex: string;
}

let tempPolyIdCounter = -1;

// ---- helpers ----

function vDist(
  a: [number, number, number],
  b: [number, number, number],
): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

function effectiveNodes(
  allNodes: TopologicalNode[],
  m: Mutations,
): TopologicalNode[] {
  const deleted = new Set(m.deletePolyIds);
  const moveMap = new Map(m.movePoly.map((mp) => [mp.id, mp.center]));
  return allNodes
    .filter((n) => !deleted.has(n.id))
    .map((n) => {
      const newCenter = moveMap.get(n.id);
      if (newCenter) {
        return { ...n, position: [...newCenter] };
      }
      return n;
    });
}

function effectiveEdges(
  allEdges: TopologicalEdge[],
  nodes: TopologicalNode[],
  m: Mutations,
): TopologicalEdge[] {
  const deleted = new Set(m.deletePolyIds);
  const removed = new Set(m.removeEdges.map((e) => edgeKey(e.srcId, e.dstId)));
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  const existing = allEdges.filter((e) => {
    if (deleted.has(e.srcId) || deleted.has(e.dstId)) return false;
    if (removed.has(edgeKey(e.srcId, e.dstId))) return false;
    return true;
  });

  const added: TopologicalEdge[] = [];
  for (const ae of m.addEdges) {
    if (deleted.has(ae.srcId) || deleted.has(ae.dstId)) continue;
    const src = nodeMap.get(ae.srcId);
    const dst = nodeMap.get(ae.dstId);
    if (!src || !dst) continue;
    const key = edgeKey(ae.srcId, ae.dstId);
    if (removed.has(key)) continue;
    if (existing.some((e) => edgeKey(e.srcId, e.dstId) === key)) continue;
    if (added.some((e) => edgeKey(e.srcId, e.dstId) === key)) continue;
    added.push({
      srcId: ae.srcId,
      dstId: ae.dstId,
      length: vDist(src.position, dst.position),
      srcPos: src.position,
      dstPos: dst.position,
      srcColorHex: src.colorHex,
      dstColorHex: dst.colorHex,
      crossArea: src.areaId !== dst.areaId,
    });
  }

  return [...existing, ...added];
}

/** Find area that contains a world-space point. Returns first match or null. */
function findAreaForPoint(
  areas: SceneData["areas"],
  point: [number, number, number],
): number {
  for (const a of areas) {
    if (
      point[0] >= a.boxMin[0] &&
      point[0] <= a.boxMax[0] &&
      point[1] >= a.boxMin[1] &&
      point[1] <= a.boxMax[1] &&
      point[2] >= a.boxMin[2] &&
      point[2] <= a.boxMax[2]
    ) {
      return a.id;
    }
  }
  return areas[0]?.id ?? 0;
}

// ---- click handler (inside Canvas) ----

function ClickHandler({
  nodes,
  edges,
  editMode,
  createMode,
  onSelectNode,
  onSelectEdge,
  onDeselectAll,
  onCreateNode,
}: {
  nodes: TopologicalNode[];
  edges: TopologicalEdge[];
  editMode: boolean;
  createMode: boolean;
  onSelectNode: (id: number, ctrl: boolean) => void;
  onSelectEdge: (key: string) => void;
  onDeselectAll: () => void;
  onCreateNode: (pos: [number, number, number]) => void;
}) {
  const { gl, camera, raycaster } = useThree();

  useEffect(() => {
    if (!editMode) return;
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    let mouseDown = new THREE.Vector2();
    let mouseUp = new THREE.Vector2();

    const onDown = (e: MouseEvent) => {
      mouseDown.set(e.clientX, e.clientY);
    };

    const handler = (e: MouseEvent) => {
      mouseUp.set(e.clientX, e.clientY);
      if (mouseDown.distanceTo(mouseUp) > 3) return; // drag, not click

      const el = e.target as HTMLElement;
      if (
        el.closest("[data-overlay]") ||
        el.tagName === "BUTTON" ||
        el.tagName === "INPUT" ||
        el.tagName === "LABEL"
      )
        return;

      const rect = gl.domElement.getBoundingClientRect();
      const mx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const my = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(new THREE.Vector2(mx, my), camera);
      const ray = raycaster.ray;

      if (!createMode) {
        let bestNodeId: number | null = null;
        let bestNodeDist = 0.15;
        for (const n of nodes) {
          const d = ray.distanceToPoint(
            new THREE.Vector3(n.position[0], n.position[1], n.position[2]),
          );
          if (d < bestNodeDist) {
            bestNodeDist = d;
            bestNodeId = n.id;
          }
        }

        if (bestNodeId !== null) {
          e.stopPropagation();
          onSelectNode(bestNodeId, e.ctrlKey || e.metaKey);
          return;
        }

        let bestEdgeKey: string | null = null;
        let bestEdgeDSq = 0.04;
        for (const edge of edges) {
          const p1 = new THREE.Vector3(
            edge.srcPos[0],
            edge.srcPos[1],
            edge.srcPos[2],
          );
          const p2 = new THREE.Vector3(
            edge.dstPos[0],
            edge.dstPos[1],
            edge.dstPos[2],
          );
          const dSq = ray.distanceSqToSegment(p1, p2);
          if (dSq < bestEdgeDSq) {
            bestEdgeDSq = dSq;
            bestEdgeKey =
              edge.srcId < edge.dstId
                ? `${edge.srcId}_${edge.dstId}`
                : `${edge.dstId}_${edge.srcId}`;
          }
        }

        if (bestEdgeKey !== null) {
          e.stopPropagation();
          onSelectEdge(bestEdgeKey);
          return;
        }
      }

      const groundPt = new THREE.Vector3();
      const hit = ray.intersectPlane(plane, groundPt);
      if (hit) {
        onCreateNode([hit.x, hit.y, hit.z]);
      } else {
        onDeselectAll();
      }
    };

    gl.domElement.addEventListener("mousedown", onDown, { capture: true });
    gl.domElement.addEventListener("click", handler, { capture: true });
    return () => {
      gl.domElement.removeEventListener("mousedown", onDown, { capture: true });
      gl.domElement.removeEventListener("click", handler, { capture: true });
    };
  }, [
    editMode,
    createMode,
    nodes,
    edges,
    gl,
    camera,
    raycaster,
    onSelectNode,
    onSelectEdge,
    onDeselectAll,
    onCreateNode,
  ]);

  return null;
}

// ---- scene ----

function Scene({
  data,
  effectiveNodes: tNodes,
  effectiveEdges: tEdges,
  layers,
  selectedArea,
  selectedNodeIds,
  selectedEdgeKey,
  editMode,
  createMode,
  moveNodeId,
  tempPolys,
  onSelectNode,
  onSelectEdge,
  onDeselectAll,
  onNodeMoved,
  onCreateNode,
  meshOpacity,
}: {
  data: SceneData;
  effectiveNodes: TopologicalNode[];
  effectiveEdges: TopologicalEdge[];
  layers: Layers;
  selectedArea: number | null;
  selectedNodeIds: Set<number>;
  selectedEdgeKey: string | null;
  editMode: boolean;
  createMode: boolean;
  moveNodeId: number | null;
  tempPolys: TempPoly[];
  onSelectNode: (id: number, ctrl: boolean) => void;
  onSelectEdge: (key: string | null) => void;
  onDeselectAll: () => void;
  onNodeMoved: (id: number, pos: [number, number, number]) => void;
  onCreateNode: (pos: [number, number, number]) => void;
  meshOpacity: number;
}) {
  const objects = useMemo(
    () =>
      data.objects.map((obj) => (
        <PointCloudObject key={obj.id} obj={obj} visible={layers.objects} />
      )),
    [data, layers.objects],
  );

  const areaBoxes = useMemo(
    () =>
      data.areas.map((a) => (
        <AreaBox
          key={a.id}
          area={a}
          visible={layers.areas}
          selected={a.id === selectedArea}
        />
      )),
    [data, layers.areas, selectedArea],
  );

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
        {layers.areaCenters && (
          <AreaCenters areas={data.areas} visible />
        )}
        {(layers.polyPoints || layers.polyWireframe) && (
          <PolyhedraAll
            data={data}
            visible={layers.polyPoints}
            showWireframe={layers.polyWireframe}
            selectedArea={selectedArea}
          />
        )}
        {layers.polyMesh && (
          <PolyMesh
            polys={data.polys}
            visible
            opacity={meshOpacity}
            selectedArea={selectedArea}
          />
        )}
        {layers.topoEdges && (
          <TopologicalEdges
            edges={tEdges}
            visible
            selectedArea={selectedArea}
            selectedEdgeKey={selectedEdgeKey}
          />
        )}
        {layers.topoNodes && (
          <TopologicalNodes
            nodes={tNodes}
            visible
            selectedArea={selectedArea}
            selectedNodeIds={selectedNodeIds}
            editMode={editMode}
            moveNodeId={moveNodeId}
            onNodeMoved={onNodeMoved}
          />
        )}
        {layers.objPolyEdges && (
          <ObjectPolyEdges data={data} visible />
        )}

        {/* Click handler: processes clicks for node/edge selection + create */}
        <ClickHandler
          nodes={tNodes}
          edges={tEdges}
          editMode={editMode}
          createMode={moveNodeId !== null ? false : createMode}
          onSelectNode={onSelectNode}
          onSelectEdge={onSelectEdge}
          onDeselectAll={onDeselectAll}
          onCreateNode={onCreateNode}
        />

        {/* Rendered temp polys (cubes) */}
        {editMode &&
          tempPolys.map((tp) => (
            <mesh key={`tp-${tp.id}`} position={tp.position}>
              <boxGeometry args={[tp.size, tp.size, tp.size]} />
              <meshBasicMaterial
                color={tp.colorHex}
                transparent
                opacity={0.7}
                depthTest
              />
            </mesh>
          ))}
      </group>

      <gridHelper args={[80, 80, "#333", "#222"]} />
      <OrbitControls
        enableDamping
        dampingFactor={0.1}
        maxDistance={400}
        minDistance={1}
        enabled={moveNodeId === null}
      />
    </Canvas>
  );
}

// ---- app ----

export function App() {
  const [data, setData] = useState<SceneData | null>(null);
  const [snapshot, setSnapshot] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [layers, setLayers] = useState<Layers>({
    objects: false,
    areas: true,
    areaEdges: false,
    areaCenters: false,
    polyPoints: false,
    polyWireframe: false,
    polyMesh: true,
    topoNodes: true,
    topoEdges: true,
    objPolyEdges: false,
  });
  const [selectedArea, setSelectedArea] = useState<number | null>(null);
  const [meshOpacity, setMeshOpacity] = useState(0.1);

  // Edit state
  const [editMode, setEditMode] = useState<EditMode>("view");
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<number>>(
    new Set(),
  );
  const [selectedEdgeKey, setSelectedEdgeKey] = useState<string | null>(null);
  const [mutations, setMutations] = useState<Mutations>(emptyMutations());
  const [moveNodeId, setMoveNodeId] = useState<number | null>(null);
  const [createMode, setCreateMode] = useState(false);
  const [tempPolys, setTempPolys] = useState<TempPoly[]>([]);
  const [exporting, setExporting] = useState(false);

  const dirty = mutationCount(mutations) > 0;

  useEffect(() => {
    loadSceneBin("/data/scene.bin")
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));

    fetch("/data/manifest.json")
      .then((r) => r.json())
      .then((m) => setSnapshot(m.snapshot || ""))
      .catch(() => {});
  }, []);

  // ---- node selection ----

  const handleSelectNode = useCallback(
    (id: number, ctrl: boolean) => {
      if (createMode) return;
      setSelectedNodeIds((prev) => {
        const next = new Set(ctrl ? prev : []);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
      setSelectedEdgeKey(null);
    },
    [createMode],
  );

  // ---- edge selection ----

  const handleSelectEdge = useCallback((key: string | null) => {
    if (createMode) return;
    setSelectedEdgeKey(key);
    setSelectedNodeIds(new Set());
    setMoveNodeId(null);
  }, [createMode]);

  const handleDeselectAll = useCallback(() => {
    if (createMode) return;
    setSelectedNodeIds(new Set());
    setSelectedEdgeKey(null);
    setMoveNodeId(null);
  }, [createMode]);

  // ---- create node ----

  const handleCreateNode = useCallback(
    (pos: [number, number, number]) => {
      if (!createMode || !data) return;
      const areaId = findAreaForPoint(data.areas, pos);
      const colorHex = data.areas.find((a) => a.id === areaId)?.colorHex ?? "#888";
      const size = 0.3;

      setMutations((prev) =>
        addCreatePoly(prev, { areaId, center: pos, size }),
      );

      const tid = tempPolyIdCounter--;
      setTempPolys((prev) => [
        ...prev,
        { id: tid, areaId, position: pos, size, colorHex },
      ]);

      setCreateMode(false);
    },
    [createMode, data],
  );

  // ---- node move ----

  const handleNodeMoved = useCallback(
    (id: number, pos: [number, number, number]) => {
      setMutations((prev) => addMovePoly(prev, { id, center: pos }));
    },
    [],
  );

  // ---- keyboard ----

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;

      if (e.key === "Escape") {
        handleDeselectAll();
        setMoveNodeId(null);
        setCreateMode(false);
        return;
      }

      if (editMode !== "edit") return;

      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedEdgeKey) {
          const [a, b] = selectedEdgeKey.split("_").map(Number);
          setMutations((prev) => addRemoveEdge(prev, { srcId: a, dstId: b }));
          setSelectedEdgeKey(null);
        } else if (selectedNodeIds.size > 0) {
          for (const nid of selectedNodeIds) {
            setMutations((prev) => addDeletePoly(prev, nid));
          }
          setSelectedNodeIds(new Set());
          setMoveNodeId(null);
        }
        return;
      }

      if (e.key === "e" || e.key === "E") {
        const arr = [...selectedNodeIds];
        if (arr.length === 2) {
          const [a, b] = arr;
          setMutations((prev) => addAddEdge(prev, { srcId: a, dstId: b }));
        }
        return;
      }

      if (e.key === "g" || e.key === "G") {
        if (selectedNodeIds.size === 1) {
          const id = [...selectedNodeIds][0];
          setMoveNodeId((prev) => (prev === id ? null : id));
          setSelectedEdgeKey(null);
        }
        return;
      }

      if (e.key === "n" || e.key === "N") {
        setCreateMode((prev) => !prev);
        setSelectedNodeIds(new Set());
        setSelectedEdgeKey(null);
        setMoveNodeId(null);
        return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [editMode, selectedNodeIds, selectedEdgeKey, handleDeselectAll]);

  // ---- edit mode toggle ----

  const handleToggleEdit = useCallback(() => {
    setEditMode((prev) => {
      if (prev === "edit") {
        // Clear selections when leaving edit mode
        setSelectedNodeIds(new Set());
        setSelectedEdgeKey(null);
        setMoveNodeId(null);
        setCreateMode(false);
        return "view";
      }
      return "edit";
    });
  }, []);

  // ---- reset ----

  const handleReset = useCallback(() => {
    setMutations(emptyMutations());
    setSelectedNodeIds(new Set());
    setSelectedEdgeKey(null);
    setMoveNodeId(null);
    setCreateMode(false);
    setTempPolys([]);
  }, []);

  // ---- export ----

  const handleExport = useCallback(async () => {
    if (!dirty || exporting || !snapshot) return;
    setExporting(true);
    try {
      const resp = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot, mutations }),
      });
      const json: ExportResponse = await resp.json();
      if (!json.success) {
        setError(`Export failed: ${json.error}`);
        return;
      }
      // Reload data
      const newData = await loadSceneBin("/data/scene.bin");
      setData(newData);
      setMutations(emptyMutations());
      setSelectedNodeIds(new Set());
      setSelectedEdgeKey(null);
      setMoveNodeId(null);
      setCreateMode(false);
      setTempPolys([]);
      setError(null);
    } catch (e: any) {
      setError(`Export error: ${e.message}`);
    } finally {
      setExporting(false);
    }
  }, [dirty, exporting, snapshot, mutations]);

  // ---- layer toggle ----

  const toggle = useCallback((key: LayerKey) => {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // ---- derived effective data for display ----

  const effectiveTNodes = useMemo(
    () => (data ? effectiveNodes(data.topoNodes, mutations) : []),
    [data, mutations],
  );

  const effectiveTEdges = useMemo(
    () =>
      data
        ? effectiveEdges(data.topoEdges, effectiveTNodes, mutations)
        : [],
    [data, mutations, effectiveTNodes],
  );

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {error && <ErrorBanner msg={error} />}

      {/* Edit toolbar */}
      <EditToolbar
        editMode={editMode}
        mutationCount={mutationCount(mutations)}
        dirty={dirty}
        exporting={exporting}
        onToggleEdit={handleToggleEdit}
        onReset={handleReset}
        onExport={handleExport}
      />

      {data && (
        <>
          {/* Layer toggles */}
          <div
            data-overlay
            style={{
              position: "absolute",
              top: 54,
              right: 16,
              zIndex: 10,
              background: "rgba(0,0,0,0.82)",
              borderRadius: 8,
              padding: "12px 16px",
              color: "#ccc",
              fontFamily: "monospace",
              fontSize: 12,
              minWidth: 200,
              userSelect: "none",
            }}
          >
            <div
              style={{
                color: "#fff",
                fontWeight: 600,
                marginBottom: 8,
                fontSize: 13,
              }}
            >
              Layers
            </div>

            <Toggle
              label="Object Clouds"
              k="objects"
              layers={layers}
              toggle={toggle}
            />
            <Toggle
              label="Area Boxes"
              k="areas"
              layers={layers}
              toggle={toggle}
            />
            <Toggle
              label="Area Edges"
              k="areaEdges"
              layers={layers}
              toggle={toggle}
            />
            <Toggle
              label="Area Centers"
              k="areaCenters"
              layers={layers}
              toggle={toggle}
            />

            <div style={{ margin: "6px 0 4px", borderTop: "1px solid #333" }} />
            <div style={{ fontSize: 10, color: "#888", marginBottom: 2 }}>
              Polyhedra
            </div>
            <Toggle
              label="Poly Points"
              k="polyPoints"
              layers={layers}
              toggle={toggle}
            />
            <Toggle
              label="Poly Wireframe"
              k="polyWireframe"
              layers={layers}
              toggle={toggle}
            />
            <Toggle
              label="Poly Mesh"
              k="polyMesh"
              layers={layers}
              toggle={toggle}
            />
            {layers.polyMesh && (
              <div style={{ paddingLeft: 20, marginTop: 2, marginBottom: 4 }}>
                <input
                  type="range"
                  min={1}
                  max={100}
                  value={Math.round(meshOpacity * 100)}
                  onChange={(e) =>
                    setMeshOpacity(Number(e.target.value) / 100)
                  }
                  style={{
                    width: "100%",
                    accentColor: "#3498db",
                    height: 4,
                  }}
                />
                <span style={{ fontSize: 10, color: "#888" }}>
                  {Math.round(meshOpacity * 100)}%
                </span>
              </div>
            )}

            <div style={{ margin: "6px 0 4px", borderTop: "1px solid #333" }} />
            <div style={{ fontSize: 10, color: "#888", marginBottom: 2 }}>
              Topology Graph
            </div>
            <Toggle
              label="Topo Nodes"
              k="topoNodes"
              layers={layers}
              toggle={toggle}
            />
            <Toggle
              label="Topo Edges"
              k="topoEdges"
              layers={layers}
              toggle={toggle}
            />

            <div style={{ margin: "6px 0 4px", borderTop: "1px solid #333" }} />
            <Toggle
              label="Obj→Poly Edges"
              k="objPolyEdges"
              layers={layers}
              toggle={toggle}
            />
          </div>

          {/* Area list */}
          <div
            data-overlay
            style={{
              position: "absolute",
              bottom: 16,
              left: 16,
              zIndex: 10,
              background: "rgba(0,0,0,0.75)",
              borderRadius: 8,
              padding: "10px 14px",
              color: "#ccc",
              fontFamily: "monospace",
              fontSize: 12,
              maxHeight: "40vh",
              overflowY: "auto",
              minWidth: 170,
            }}
          >
            <div
              style={{
                color: "#fff",
                fontWeight: 600,
                marginBottom: 6,
                fontSize: 13,
              }}
            >
              Areas ({data.areas.length})
            </div>
            {data.areas.map((a) => (
              <div
                key={a.id}
                onClick={() =>
                  setSelectedArea(a.id === selectedArea ? null : a.id)
                }
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "2px 4px",
                  cursor: "pointer",
                  borderRadius: 4,
                  background:
                    a.id === selectedArea
                      ? "rgba(255,255,255,0.1)"
                      : "transparent",
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    flexShrink: 0,
                    backgroundColor: a.colorHex,
                    border: "1px solid rgba(255,255,255,0.15)",
                  }}
                />
                <span>{a.roomLabel || `A${a.id}`}</span>
                <span
                  style={{ color: "#666", marginLeft: "auto", fontSize: 10 }}
                >
                  {a.polyIds.length}p
                </span>
              </div>
            ))}
          </div>

          {/* Objects */}
          <div
            data-overlay
            style={{
              position: "absolute",
              top: 54,
              left: 16,
              zIndex: 10,
              background: "rgba(0,0,0,0.75)",
              borderRadius: 8,
              padding: "10px 14px",
              color: "#ccc",
              fontFamily: "monospace",
              fontSize: 12,
              minWidth: 160,
            }}
          >
            <div
              style={{
                color: "#fff",
                fontWeight: 600,
                marginBottom: 6,
                fontSize: 13,
              }}
            >
              Objects ({data.objects.length})
            </div>
            {data.objects.map((obj) => (
              <div
                key={obj.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "2px 0",
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    flexShrink: 0,
                    backgroundColor: obj.colorHex,
                    border: "1px solid rgba(255,255,255,0.15)",
                  }}
                />
                <span>
                  {obj.label} [{obj.id}]
                </span>
                <span
                  style={{ color: "#666", marginLeft: "auto", fontSize: 10 }}
                >
                  {obj.pointCount}pts
                </span>
              </div>
            ))}
          </div>

          {/* Stats */}
          <div
            style={{
              position: "absolute",
              bottom: 16,
              right: 16,
              zIndex: 10,
              background: "rgba(0,0,0,0.6)",
              borderRadius: 6,
              padding: "6px 12px",
              color: "#888",
              fontFamily: "monospace",
              fontSize: 11,
            }}
          >
            Polys: {effectiveTNodes.length} &middot; Nodes:{" "}
            {effectiveTNodes.length} &middot; TopoEdges:{" "}
            {effectiveTEdges.length}
          </div>
        </>
      )}

      {data ? (
        <Scene
          data={data}
          effectiveNodes={effectiveTNodes}
          effectiveEdges={effectiveTEdges}
          layers={layers}
          selectedArea={selectedArea}
          selectedNodeIds={selectedNodeIds}
          selectedEdgeKey={selectedEdgeKey}
          editMode={editMode === "edit"}
          createMode={createMode}
          moveNodeId={moveNodeId}
          tempPolys={tempPolys}
          onSelectNode={handleSelectNode}
          onSelectEdge={handleSelectEdge}
          onDeselectAll={handleDeselectAll}
          onNodeMoved={handleNodeMoved}
          onCreateNode={handleCreateNode}
          meshOpacity={meshOpacity}
        />
      ) : loading ? (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%,-50%)",
            color: "#666",
            fontSize: 14,
            fontFamily: "monospace",
          }}
        >
          Loading...
        </div>
      ) : null}
    </div>
  );
}

// ---- Toggle & ErrorBanner ----

function Toggle({
  label,
  k,
  layers,
  toggle,
}: {
  label: string;
  k: LayerKey;
  layers: Layers;
  toggle: (k: LayerKey) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "2px 0",
        cursor: "pointer",
      }}
    >
      <input
        type="checkbox"
        checked={layers[k]}
        onChange={() => toggle(k)}
        style={{ accentColor: "#3498db" }}
      />
      <span>{label}</span>
    </label>
  );
}

function ErrorBanner({ msg }: { msg: string }) {
  return (
    <div
      style={{
        position: "absolute",
        top: 48,
        left: 16,
        zIndex: 20,
        background: "rgba(200,0,0,0.85)",
        color: "#fff",
        padding: "8px 16px",
        borderRadius: 6,
        fontSize: 13,
        fontFamily: "monospace",
      }}
    >
      {msg}
    </div>
  );
}
