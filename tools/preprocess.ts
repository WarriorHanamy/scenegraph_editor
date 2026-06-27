#!/usr/bin/env bun
/**
 * Preprocess scene graph snapshot → single scene.bin.
 *
 * Layout (LE):
 *   [u32] magic 0x5347444E
 *   [u32] objCount
 *   For each obj: [u32] id,N,labelLen, [u8*]label 4p, [f32*3]color,
 *                 [u32] fatherPolyId, [f32*3]center,
 *                 [f32*N*3]pos, [f32*N*3]col
 *   [u32] areaCount
 *   For each area: [u32] id,labelLen, [u8*]label 4p, [f32*3]boxMin/Max/center, [f32*3]color,
 *                  [u32]nc,[u32*]neighborIds, [u32]pc,[u32*]polyIds
 *   [u32] polyCount
 *   For each poly: [u32] id,areaId, [f32*3]center, [f32*3]color,
 *                  [u32]V,[f32*V*3]pos, [u32]E,[u32*E*2]edgeIdxPairs,
 *                  [u32]Ac,[u32*]adjacentPolyIds, [u32]Gc,[u32*]gatewayNodeIds
 *   [u32] topoEdgeCount
 *   For each edge: [u32]srcId,dstId, [f32]length,
 *                  [f32*3]srcPos,dstPos,srcColor,dstColor, [u8]crossArea
 */

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const SAVED_DIR = join(import.meta.dirname, "..", "scene_graph_saved");
const OUT_DIR  = join(import.meta.dirname, "..", "frontend", "public", "data");

type V3 = [number, number, number];

// ---- extract ----

function c3(v: any, fb: number): number { const n = Number(v); return isFinite(n) ? n : fb; }

function findLatestSnapshot(): string {
  const es = readdirSync(SAVED_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && statSync(join(SAVED_DIR, e.name, "scene_graph.json")).isFile());
  es.sort((a, b) => statSync(join(SAVED_DIR, b.name)).mtimeMs - statSync(join(SAVED_DIR, a.name)).mtimeMs);
  return join(SAVED_DIR, es[0].name);
}

function parsePCDHeader(buf: Buffer): { pointCount: number; dataOffset: number } {
  const t = buf.toString("utf-8", 0, Math.min(1024, buf.length));
  let n = 0;
  for (const l of t.split("\n")) {
    if (l.startsWith("POINTS") || l.startsWith("WIDTH")) n = parseInt(l.split(/\s+/)[1], 10);
  }
  return { pointCount: n, dataOffset: buf.indexOf("DATA binary\n") + "DATA binary\n".length };
}

function readPCD(path: string): { count: number; positions: Float32Array; center: V3 } {
  const buf = readFileSync(path);
  const { pointCount, dataOffset } = parsePCDHeader(buf);
  const pos = new Float32Array(pointCount * 3);
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < pointCount; i++) {
    const b = dataOffset + i * 16;
    const x = buf.readFloatLE(b), y = buf.readFloatLE(b + 4), z = buf.readFloatLE(b + 8);
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    cx += x; cy += y; cz += z;
  }
  return { count: pointCount, positions: pos, center: [cx / pointCount, cy / pointCount, cz / pointCount] };
}

// ---- extract data ----

function extractObjects(root: any, snapDir: string) {
  return (root.objects || []).filter((o: any) => o.files?.cloud).map((o: any) => {
    const fp = Number(o.edge?.father_poly_id) ?? -1;
    return {
      id: o.id, label: o.label || "unknown",
      cloudPath: join(snapDir, o.files.cloud),
      color: [c3(o.color?.[0], 128) / 255, c3(o.color?.[1], 128) / 255, c3(o.color?.[2], 128) / 255] as V3,
      fatherPolyId: fp >= 0 ? fp : 0xFFFFFFFF,
    };
  });
}

function extractAreas(root: any) {
  return (root.areas || []).map((a: any) => ({
    id: a.id,
    roomLabel: a.room_label || "Unknown",
    boxMin:  [c3(a.box_min?.[0],0), c3(a.box_min?.[1],0), c3(a.box_min?.[2],0)] as V3,
    boxMax:  [c3(a.box_max?.[0],0), c3(a.box_max?.[1],0), c3(a.box_max?.[2],0)] as V3,
    center:  [c3(a.center?.[0],0), c3(a.center?.[1],0), c3(a.center?.[2],0)] as V3,
    color:   [c3(a.color?.[0],0.5), c3(a.color?.[1],0.5), c3(a.color?.[2],0.5)] as V3,
    neighborIds: (a.neighbor_area_ids || []).map(Number),
    polyIds: (a.poly_ids || []).map(Number),
  }));
}

function extractPolys(root: any, areaColors: Map<number, V3>) {
  const vmap = new Map<number, { pos: V3; conn: number[] }>();
  for (const v of root.vertices || []) vmap.set(v.id, { pos: v.position, conn: v.connected_vertex_ids || [] });

  return (root.polyhedrons || []).map((p: any) => {
    const vids: number[] = [...(p.white_vertex_ids || []), ...(p.black_vertex_ids || [])];
    const positions = new Float32Array(vids.length * 3);
    const idxMap = new Map<number, number>();
    for (let i = 0; i < vids.length; i++) {
      const v = vmap.get(vids[i]);
      if (!v) continue;
      idxMap.set(vids[i], i);
      positions[i * 3] = v.pos[0]; positions[i * 3 + 1] = v.pos[1]; positions[i * 3 + 2] = v.pos[2];
    }

    // internal wireframe (vertex → vertex)
    const edgeSet = new Set<string>();
    const idSet = new Set(vids);
    for (const vid of vids) {
      const v = vmap.get(vid);
      if (!v) continue;
      for (const cid of v.conn) {
        if (!idSet.has(cid)) continue;
        edgeSet.add([vid, cid].sort().join("_"));
      }
    }
    const ep: number[] = [];
    for (const k of edgeSet) {
      const [a, b] = k.split("_").map(Number);
      const ai = idxMap.get(a), bi = idxMap.get(b);
      if (ai !== undefined && bi !== undefined) ep.push(ai, bi);
    }

    const aid = p.area_id >= 0 ? p.area_id : 0xFFFFFFFF;
    const col = p.area_id >= 0 ? (areaColors.get(p.area_id) || [0.5, 0.5, 0.5]) : [0.4, 0.4, 0.4];

    return {
      id: p.id, areaId: aid, center: p.center as V3, color: col as V3,
      positions, edgePairsArr: ep,
      adjacentPolyIds: (p.edges || []).map((e: any) => Number(e.dst_poly_id)),
      gatewayNodeIds: (p.connected_node_ids || []).map(Number),
    };
  });
}

function buildTopoEdges(polys: ReturnType<typeof extractPolys>, areaColors: Map<number, V3>) {
  const edgeMap = new Map<string, { s: number; d: number; len: number; cross: boolean }>();
  const polyMap = new Map<number, { center: V3; areaId: number; color: V3 }>();
  for (const p of polys) polyMap.set(p.id, { center: p.center, areaId: p.areaId, color: p.color });

  const add = (s: number, d: number, len: number, from: "edge" | "gateway") => {
    if (!polyMap.has(s) || !polyMap.has(d)) return;
    const key = [s, d].sort().join("_");
    if (edgeMap.has(key)) return;
    const src = polyMap.get(s)!, dst = polyMap.get(d)!;
    edgeMap.set(key, { s, d, len, cross: src.areaId !== dst.areaId });
  };

  for (const p of polys) {
    for (const dp of p.adjacentPolyIds) add(p.id, dp, 0, "edge");
    for (const dp of p.gatewayNodeIds) add(p.id, dp, 0, "gateway");
  }

  return [...edgeMap.values()].map(e => ({
    srcId: e.s, dstId: e.d, length: e.len,
    srcPos: polyMap.get(e.s)!.center, dstPos: polyMap.get(e.d)!.center,
    srcColor: polyMap.get(e.s)!.color, dstColor: polyMap.get(e.d)!.color,
    crossArea: e.cross,
  }));
}

// ---- binary writer ----

type Bin = { buf: Buffer; off: number };
const enc = new TextEncoder();
const wU32 = (b: Bin, v: number) => { b.buf.writeUInt32LE(v >>> 0, b.off); b.off += 4; };
const wF32 = (b: Bin, v: number) => { b.buf.writeFloatLE(v, b.off); b.off += 4; };
const wV3  = (b: Bin, v: V3) => { wF32(b, v[0]); wF32(b, v[1]); wF32(b, v[2]); };
function wStr(b: Bin, s: string) {
  const bytes = enc.encode(s);
  const padded = Math.ceil(bytes.length / 4) * 4;
  wU32(b, bytes.length);
  b.buf.set(bytes, b.off); b.off += padded;
}

function computeSize(
  objs: { label: string }[], pcds: { count: number }[],
  areas: { roomLabel: string; neighborIds: number[]; polyIds: number[] }[],
  polys: ReturnType<typeof extractPolys>,
  topoEdges: ReturnType<typeof buildTopoEdges>,
): number {
  let sz = 8; // magic+objCount
  for (let i = 0; i < objs.length; i++) {
    sz += 4 + 4 + 4 + Math.ceil(enc.encode(objs[i].label).length / 4) * 4 + 12 + 4 + 12;
    sz += pcds[i].count * 3 * 4 * 2;
  }
  sz += 4; // areaCount
  for (const a of areas) {
    sz += 4 + 4 + Math.ceil(enc.encode(a.roomLabel).length / 4) * 4 + 48 + 8;
    sz += a.neighborIds.length * 4 + a.polyIds.length * 4;
  }
  sz += 4; // polyCount
  for (const p of polys) {
    sz += 4 + 4 + 12 + 12 + 4 + p.positions.length * 4 + 4 + p.edgePairsArr.length * 4;
    sz += 4 + p.adjacentPolyIds.length * 4;
    sz += 4 + p.gatewayNodeIds.length * 4;
  }
  sz += 4; // topoEdgeCount
  for (const e of topoEdges) {
    sz += 4 + 4 + 4 + 12 + 12 + 12 + 12 + 1;
  }
  return sz;
}

function buildBinary(
  objs: any[], pcds: { count: number; positions: Float32Array; center: V3 }[],
  areas: ReturnType<typeof extractAreas>,
  polys: ReturnType<typeof extractPolys>,
  topoEdges: ReturnType<typeof buildTopoEdges>,
): Buffer {
  const bin = Buffer.alloc(computeSize(objs, pcds, areas, polys, topoEdges));
  const b: Bin = { buf: bin, off: 0 };
  wU32(b, 0x5347444e);

  // objects
  wU32(b, objs.length);
  for (let i = 0; i < objs.length; i++) {
    const o = objs[i], d = pcds[i];
    wU32(b, o.id); wU32(b, d.count); wStr(b, o.label);
    wV3(b, o.color); wU32(b, o.fatherPolyId); wV3(b, d.center);
    const pf = new Float32Array(bin.buffer, bin.byteOffset + b.off, d.count * 3);
    pf.set(d.positions); b.off += d.count * 12;
    const cf = new Float32Array(bin.buffer, bin.byteOffset + b.off, d.count * 3);
    const [cr, cg, cb] = o.color;
    for (let j = 0; j < d.count; j++) { cf[j * 3] = cr; cf[j * 3 + 1] = cg; cf[j * 3 + 2] = cb; }
    b.off += d.count * 12;
  }

  // areas
  wU32(b, areas.length);
  for (const a of areas) {
    wU32(b, a.id); wStr(b, a.roomLabel);
    wV3(b, a.boxMin); wV3(b, a.boxMax); wV3(b, a.center); wV3(b, a.color);
    wU32(b, a.neighborIds.length);
    for (const n of a.neighborIds) wU32(b, n);
    wU32(b, a.polyIds.length);
    for (const p of a.polyIds) wU32(b, p);
  }

  // polyhedrons
  wU32(b, polys.length);
  for (const p of polys) {
    wU32(b, p.id); wU32(b, p.areaId);
    wV3(b, p.center); wV3(b, p.color);
    const V = p.positions.length / 3;
    wU32(b, V);
    if (V > 0) {
      const pf = new Float32Array(bin.buffer, bin.byteOffset + b.off, V * 3);
      pf.set(p.positions); b.off += V * 12;
    }
    wU32(b, p.edgePairsArr.length / 2);
    if (p.edgePairsArr.length > 0) {
      const ef = new Uint32Array(bin.buffer, bin.byteOffset + b.off, p.edgePairsArr.length);
      ef.set(p.edgePairsArr); b.off += p.edgePairsArr.length * 4;
    }
    wU32(b, p.adjacentPolyIds.length);
    for (const ap of p.adjacentPolyIds) wU32(b, ap);
    wU32(b, p.gatewayNodeIds.length);
    for (const gp of p.gatewayNodeIds) wU32(b, gp);
  }

  // topological edges
  wU32(b, topoEdges.length);
  for (const e of topoEdges) {
    wU32(b, e.srcId); wU32(b, e.dstId);
    wF32(b, e.length);
    wV3(b, e.srcPos); wV3(b, e.dstPos);
    wV3(b, e.srcColor); wV3(b, e.dstColor);
    b.buf.writeUInt8(e.crossArea ? 1 : 0, b.off); b.off += 1;
  }

  return bin;
}

// ---- main ----

function main() {
  const snapDir = findLatestSnapshot();
  const root = JSON.parse(readFileSync(join(snapDir, "scene_graph.json"), "utf-8"));
  const areas = extractAreas(root);
  const areaColors = new Map<number, V3>();
  for (const a of areas) areaColors.set(a.id, a.color);

  const objs = extractObjects(root, snapDir);
  const pcds = objs.map(o => readPCD(o.cloudPath));
  const polys = extractPolys(root, areaColors);
  const topoEdges = buildTopoEdges(polys, areaColors);

  console.log(`Snapshot: ${snapDir.split("/").pop()}`);
  console.log(`Objects: ${objs.length}  Areas: ${areas.length}  Polys: ${polys.length}`);
  console.log(`TopoEdges: ${topoEdges.length} (crossArea: ${topoEdges.filter(e => e.crossArea).length})`);

  const bin = buildBinary(objs, pcds, areas, polys, topoEdges);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "scene.bin"), bin);
  console.log(`Written: scene.bin (${(bin.length / 1024).toFixed(1)} KB)`);

  const m = {
    snapshot: snapDir.split("/").pop(),
    objectCount: objs.length, areaCount: areas.length, polyCount: polys.length,
    topoEdgeCount: topoEdges.length,
  };
  writeFileSync(join(OUT_DIR, "manifest.json"), JSON.stringify(m, null, 2));
  console.log("Done.");
}

main();
