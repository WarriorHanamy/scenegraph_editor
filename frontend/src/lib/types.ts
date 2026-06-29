/**
 * Scene Graph Data Model
 *
 *  Area ──┬── Poly (convex free-space cell)
 *         │    ├── internal vertices (white + black)
 *         │    ├── internal wireframe (vertex→vertex edgeIndices)
 *         │    ├── adjacentPolyIds   (edges[].dst_poly_id — intra-area path planning)
 *         │    ├── gatewayNodeIds    (connected_node_ids — cross-area gateways)
 *         └── neighbor_area_ids (Area→Area)
 *
 *  TopologicalNode  — poly center, top-level renderable, CRUD target
 *  TopologicalEdge  — Poly↔Poly adjacency (from edges[] + connected_node_ids[])
 */

export interface PreprocessedArea {
  id: number;
  roomLabel: string;
  colorHex: string;
  boxMin: [number, number, number];
  boxMax: [number, number, number];
  center: [number, number, number];
  neighborIds: number[];
  polyIds: number[];
}

export interface PreprocessedPoly {
  id: number;
  areaId: number;
  colorHex: string;
  center: [number, number, number];
  /** N*3 convex-hull vertex positions (white + black) */
  positions: Float32Array;
  /** Internal wireframe: [a0,b0, a1,b1, ...] index pairs into positions[] */
  edgeIndices: Uint32Array;
  /** Adjacent poly IDs from edges[].dst_poly_id */
  adjacentPolyIds: number[];
  /** Gateway poly IDs from connected_node_ids[] */
  gatewayNodeIds: number[];
}

/** Poly center as a first-class graph node — CRUD target */
export interface TopologicalNode {
  id: number; // == polyId
  areaId: number;
  position: [number, number, number];
  colorHex: string;
}

/** Inter-node adjacency: Poly↔Poly (from edges[] + connected_node_ids[]) */
export interface TopologicalEdge {
  srcId: number;
  dstId: number;
  length: number;
  srcPos: [number, number, number];
  dstPos: [number, number, number];
  srcColorHex: string;
  dstColorHex: string;
  crossArea: boolean;
}

export interface SceneData {
  areas: PreprocessedArea[];
  polys: PreprocessedPoly[];
  topoNodes: TopologicalNode[];
  topoEdges: TopologicalEdge[];
}

// ---- Mutations (sent to backend on export) ----

export interface MovePoly {
  id: number;
  center: [number, number, number];
}

export interface EdgeRef {
  srcId: number;
  dstId: number;
}

export interface CreatePoly {
  areaId: number;
  center: [number, number, number];
  size: number;
}

export interface Mutations {
  deletePolyIds: number[];
  movePoly: MovePoly[];
  removeEdges: EdgeRef[];
  addEdges: EdgeRef[];
  createPoly: CreatePoly[];
}

export interface ExportRequest {
  snapshot: string;
  mutations: Mutations;
  base: "saved" | "exported";
}

export interface ExportResponse {
  success: boolean;
  error?: string;
}

export type EditMode = "view" | "edit";
