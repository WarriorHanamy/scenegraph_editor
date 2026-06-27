import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import type { RefObject } from "react";
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
import { pickTarget } from "./lib/picking";
import type { PickTarget } from "./lib/picking";
import { isConnectShortcut } from "./lib/shortcuts";
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

interface ConnectionNotice {
  kind: "success" | "info" | "error";
  message: string;
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

  const existing = allEdges.flatMap((e) => {
    if (deleted.has(e.srcId) || deleted.has(e.dstId)) return [];
    if (removed.has(edgeKey(e.srcId, e.dstId))) return [];
    const src = nodeMap.get(e.srcId);
    const dst = nodeMap.get(e.dstId);
    if (!src || !dst) return [];
    return [{
      ...e,
      length: vDist(src.position, dst.position),
      srcPos: src.position,
      dstPos: dst.position,
      srcColorHex: src.colorHex,
      dstColorHex: dst.colorHex,
      crossArea: src.areaId !== dst.areaId,
    }];
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

/** Find the area containing a scene-local point. */
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
  interactionDisabled,
  sceneGroupRef,
  onSelectNode,
  onSelectEdge,
  onDeselectAll,
  onCreateNode,
  onHoverTarget,
}: {
  nodes: TopologicalNode[];
  edges: TopologicalEdge[];
  editMode: boolean;
  createMode: boolean;
  interactionDisabled: boolean;
  sceneGroupRef: RefObject<THREE.Group | null>;
  onSelectNode: (id: number, additive: boolean) => void;
  onSelectEdge: (key: string) => void;
  onDeselectAll: () => void;
  onCreateNode: (pos: [number, number, number]) => void;
  onHoverTarget: (target: PickTarget) => void;
}) {
  const { gl, camera, raycaster } = useThree();

  useEffect(() => {
    const canvas = gl.domElement;
    if (!editMode) {
      onHoverTarget(null);
      canvas.style.cursor = "";
      return;
    }

    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const mouseDown = new THREE.Vector2();
    const mouseUp = new THREE.Vector2();

    const targetAt = (e: MouseEvent | PointerEvent): PickTarget => {
      const sceneGroup = sceneGroupRef.current;
      if (!sceneGroup || createMode || interactionDisabled) return null;

      sceneGroup.updateWorldMatrix(true, false);
      camera.updateMatrixWorld();
      const rect = canvas.getBoundingClientRect();
      return pickTarget({
        nodes,
        edges,
        camera,
        sceneMatrixWorld: sceneGroup.matrixWorld,
        width: rect.width,
        height: rect.height,
        pointerX: e.clientX - rect.left,
        pointerY: e.clientY - rect.top,
      });
    };

    const onDown = (e: MouseEvent) => {
      mouseDown.set(e.clientX, e.clientY);
    };

    const onMove = (e: PointerEvent) => {
      if (e.buttons !== 0 || interactionDisabled) {
        onHoverTarget(null);
        canvas.style.cursor = "";
        return;
      }
      if (createMode) {
        onHoverTarget(null);
        canvas.style.cursor = "crosshair";
        return;
      }

      const target = targetAt(e);
      onHoverTarget(target);
      canvas.style.cursor = target ? "pointer" : "";
    };

    const onLeave = () => {
      onHoverTarget(null);
      canvas.style.cursor = "";
    };

    const onClick = (e: MouseEvent) => {
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

      if (interactionDisabled) return;

      const target = targetAt(e);
      if (target?.kind === "node") {
        e.stopPropagation();
        onSelectNode(target.id, e.shiftKey || e.ctrlKey || e.metaKey);
        return;
      }
      if (target?.kind === "edge") {
        e.stopPropagation();
        onSelectEdge(target.key);
        return;
      }

      if (!createMode) {
        onDeselectAll();
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const mx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const my = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(new THREE.Vector2(mx, my), camera);
      const groundPt = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(groundPlane, groundPt)) {
        const sceneGroup = sceneGroupRef.current;
        if (!sceneGroup) return;
        sceneGroup.updateWorldMatrix(true, false);
        const localPoint = sceneGroup.worldToLocal(groundPt);
        onCreateNode([localPoint.x, localPoint.y, localPoint.z]);
      }
    };

    canvas.style.cursor = createMode && !interactionDisabled ? "crosshair" : "";
    canvas.addEventListener("mousedown", onDown, { capture: true });
    canvas.addEventListener("pointermove", onMove, { capture: true });
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("click", onClick, { capture: true });
    return () => {
      canvas.removeEventListener("mousedown", onDown, { capture: true });
      canvas.removeEventListener("pointermove", onMove, { capture: true });
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("click", onClick, { capture: true });
      canvas.style.cursor = "";
      onHoverTarget(null);
    };
  }, [
    editMode,
    createMode,
    interactionDisabled,
    nodes,
    edges,
    gl,
    camera,
    raycaster,
    sceneGroupRef,
    onSelectNode,
    onSelectEdge,
    onDeselectAll,
    onCreateNode,
    onHoverTarget,
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
  onSelectNode: (id: number, additive: boolean) => void;
  onSelectEdge: (key: string | null) => void;
  onDeselectAll: () => void;
  onNodeMoved: (id: number, pos: [number, number, number]) => void;
  onCreateNode: (pos: [number, number, number]) => void;
  meshOpacity: number;
}) {
  const sceneGroupRef = useRef<THREE.Group>(null);
  const [hoverTarget, setHoverTarget] = useState<PickTarget>(null);
  const handleHoverTarget = useCallback((target: PickTarget) => {
    setHoverTarget((current) => {
      if (current === null || target === null) return current === target ? current : target;
      if (current.kind !== target.kind) return target;
      if (current.kind === "node" && target.kind === "node" && current.id === target.id) return current;
      if (current.kind === "edge" && target.kind === "edge" && current.key === target.key) return current;
      return target;
    });
  }, []);

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

      <group ref={sceneGroupRef} rotation={[-Math.PI / 2, 0, 0]}>
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
            hoveredEdgeKey={hoverTarget?.kind === "edge" ? hoverTarget.key : null}
          />
        )}
        {layers.topoNodes && (
          <TopologicalNodes
            nodes={tNodes}
            visible
            selectedArea={selectedArea}
            selectedNodeIds={selectedNodeIds}
            hoveredNodeId={hoverTarget?.kind === "node" ? hoverTarget.id : null}
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
          nodes={layers.topoNodes ? tNodes : []}
          edges={layers.topoEdges ? tEdges : []}
          editMode={editMode}
          createMode={createMode}
          interactionDisabled={moveNodeId !== null}
          sceneGroupRef={sceneGroupRef}
          onSelectNode={onSelectNode}
          onSelectEdge={onSelectEdge}
          onDeselectAll={onDeselectAll}
          onCreateNode={onCreateNode}
          onHoverTarget={handleHoverTarget}
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
  const [connectionNotice, setConnectionNotice] =
    useState<ConnectionNotice | null>(null);

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
    (id: number, additive: boolean) => {
      if (createMode) return;
      setSelectedNodeIds((prev) => {
        const next = new Set(additive ? prev : []);
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

  const handleConnectSelected = useCallback(() => {
    const ids = [...selectedNodeIds];
    if (ids.length !== 2) {
      setConnectionNotice({
        kind: "error",
        message: `Select exactly two nodes (currently ${ids.length})`,
      });
      return;
    }

    const [srcId, dstId] = ids;
    const key = edgeKey(srcId, dstId);
    const sourceHasEdge =
      data?.topoEdges.some((edge) => edgeKey(edge.srcId, edge.dstId) === key) ??
      false;
    const pendingRemoval = mutations.removeEdges.some(
      (edge) => edgeKey(edge.srcId, edge.dstId) === key,
    );
    const pendingAddition = mutations.addEdges.some(
      (edge) => edgeKey(edge.srcId, edge.dstId) === key,
    );

    if ((sourceHasEdge && !pendingRemoval) || pendingAddition) {
      setConnectionNotice({
        kind: "info",
        message: `Nodes ${srcId} and ${dstId} are already connected`,
      });
    } else {
      setMutations((prev) => {
        if (
          prev.removeEdges.some(
            (edge) => edgeKey(edge.srcId, edge.dstId) === key,
          )
        ) {
          return {
            ...prev,
            removeEdges: prev.removeEdges.filter(
              (edge) => edgeKey(edge.srcId, edge.dstId) !== key,
            ),
          };
        }
        return addAddEdge(prev, { srcId, dstId });
      });
      setConnectionNotice({
        kind: "success",
        message: `Connected nodes ${srcId} ↔ ${dstId}`,
      });
    }

    setSelectedNodeIds(new Set());
    setSelectedEdgeKey(key);
    setMoveNodeId(null);
  }, [data, mutations, selectedNodeIds]);

  useEffect(() => {
    if (!connectionNotice) return;
    const timeout = window.setTimeout(() => setConnectionNotice(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [connectionNotice]);

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

      if (isConnectShortcut(e)) {
        e.preventDefault();
        if (!e.repeat) handleConnectSelected();
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
  }, [
    editMode,
    selectedNodeIds,
    selectedEdgeKey,
    handleDeselectAll,
    handleConnectSelected,
  ]);

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

      {connectionNotice && (
        <div
          data-overlay
          role="status"
          style={{
            position: "absolute",
            top: 54,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 20,
            padding: "8px 14px",
            borderRadius: 6,
            background:
              connectionNotice.kind === "success"
                ? "rgba(20, 110, 65, 0.94)"
                : connectionNotice.kind === "error"
                  ? "rgba(150, 45, 45, 0.94)"
                  : "rgba(105, 85, 20, 0.94)",
            color: "#fff",
            fontFamily: "monospace",
            fontSize: 12,
            pointerEvents: "none",
          }}
        >
          {connectionNotice.message}
        </div>
      )}

      {editMode === "edit" && selectedNodeIds.size === 2 && (
        <div
          data-overlay
          style={{
            position: "absolute",
            bottom: 16,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 20,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "7px 10px",
            borderRadius: 6,
            background: "rgba(0,0,0,0.82)",
            color: "#ddd",
            fontFamily: "monospace",
            fontSize: 12,
          }}
        >
          <span>2 nodes selected</span>
          <button type="button" onClick={handleConnectSelected}>
            Connect (E)
          </button>
        </div>
      )}

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
