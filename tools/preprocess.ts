#!/usr/bin/env bun
/**
 * Preprocess scene graph snapshot into browser-optimized binary format.
 *
 * Input:  scene_graph_saved/<latest>/
 * Output: frontend/public/data/scene.bin + manifest.json
 *
 * scene.bin layout (LE):
 *   [u32] magic = 0x5347444E ("SGND")
 *   [u32] objCount
 *   For each object:
 *     [u32] id, [u32] pointCount, [u32] labelLen
 *     [u8*labelLen] label, 4-padded
 *     [f32*3] color
 *     [f32*pointCount*3] positions
 *     [f32*pointCount*3] colors
 *   [u32] areaCount
 *   For each area:
 *     [u32] id, [u32] labelLen
 *     [u8*labelLen] room_label, 4-padded
 *     [f32*3] boxMin, [f32*3] boxMax, [f32*3] center, [f32*3] color
 *     [u32] neighborCount
 *     [u32*neighborCount] neighbor_ids
 */

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const SAVED_DIR = join(import.meta.dirname, "..", "scene_graph_saved");
const OUT_DIR = join(import.meta.dirname, "..", "frontend", "public", "data");

interface ObjectEntry {
  id: number; label: string; cloudPath: string; color: [number, number, number];
}

interface AreaEntry {
  id: number; roomLabel: string;
  boxMin: [number, number, number];
  boxMax: [number, number, number];
  center: [number, number, number];
  color: [number, number, number];
  neighborIds: number[];
}

function findLatestSnapshot(): string | null {
  const entries = readdirSync(SAVED_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(SAVED_DIR, e.name))
    .filter((p) => {
      try { return statSync(join(p, "scene_graph.json")).isFile(); } catch { return false; }
    });
  if (!entries.length) return null;
  entries.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return entries[0];
}

function parsePCDHeader(buf: Buffer): { pointCount: number; dataOffset: number } {
  const text = buf.toString("utf-8", 0, Math.min(1024, buf.length));
  let pointCount = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("POINTS") || line.startsWith("WIDTH"))
      pointCount = parseInt(line.split(/\s+/)[1], 10);
  }
  return { pointCount, dataOffset: buf.indexOf("DATA binary\n") + "DATA binary\n".length };
}

function extractObjects(root: any, snapshotDir: string): ObjectEntry[] {
  return (root.objects || [])
    .filter((obj: any) => obj.files?.cloud)
    .map((obj: any) => ({
      id: obj.id, label: obj.label || "unknown",
      cloudPath: join(snapshotDir, obj.files.cloud),
      color: [(obj.color?.[0] ?? 128) / 255, (obj.color?.[1] ?? 128) / 255, (obj.color?.[2] ?? 128) / 255],
    }));
}

function extractAreas(root: any): AreaEntry[] {
  return (root.areas || []).map((a: any) => ({
    id: a.id,
    roomLabel: a.room_label || "Unknown",
    boxMin: [a.box_min?.[0] ?? 0, a.box_min?.[1] ?? 0, a.box_min?.[2] ?? 0],
    boxMax: [a.box_max?.[0] ?? 0, a.box_max?.[1] ?? 0, a.box_max?.[2] ?? 0],
    center: [a.center?.[0] ?? 0, a.center?.[1] ?? 0, a.center?.[2] ?? 0],
    color: [(a.color?.[0] ?? 0.5) / 1, (a.color?.[1] ?? 0.5) / 1, (a.color?.[2] ?? 0.5) / 1],
    neighborIds: (a.neighbor_area_ids || []).map(Number),
  }));
}

function readPCDPositions(filePath: string): { count: number; positions: Float32Array } {
  const buf = readFileSync(filePath);
  const { pointCount, dataOffset } = parsePCDHeader(buf);
  const positions = new Float32Array(pointCount * 3);
  for (let i = 0; i < pointCount; i++) {
    const base = dataOffset + i * 16;
    positions[i * 3] = buf.readFloatLE(base);
    positions[i * 3 + 1] = buf.readFloatLE(base + 4);
    positions[i * 3 + 2] = buf.readFloatLE(base + 8);
  }
  return { count: pointCount, positions };
}

function computeTotalSize(objects: ObjectEntry[], pointCounts: number[], areas: AreaEntry[]): number {
  let size = 8; // magic + objCount
  const enc = new TextEncoder();

  for (let i = 0; i < objects.length; i++) {
    const lp = Math.ceil(enc.encode(objects[i].label).length / 4) * 4;
    size += 4 + 4 + 4 + lp + 12;
    size += pointCounts[i] * 3 * 4 * 2; // pos + col
  }

  size += 4; // areaCount
  for (const a of areas) {
    const lp = Math.ceil(enc.encode(a.roomLabel).length / 4) * 4;
    size += 4 + 4 + lp + 12 * 4; // id, labelLen, label, boxMin, boxMax, center, color
    size += 4 + a.neighborIds.length * 4; // neighborCount + neighborIds
  }
  return size;
}

function buildBinary(
  objects: ObjectEntry[],
  posData: { count: number; positions: Float32Array }[],
  areas: AreaEntry[],
): Buffer {
  const pointCounts = posData.map((p) => p.count);
  const totalSize = computeTotalSize(objects, pointCounts, areas);
  const bin = Buffer.alloc(totalSize);
  const enc = new TextEncoder();
  let off = 0;

  bin.writeUInt32LE(0x5347444e, off); off += 4;
  bin.writeUInt32LE(objects.length, off); off += 4;

  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    const n = pointCounts[i];
    const lb = enc.encode(obj.label);
    const lp = Math.ceil(lb.length / 4) * 4;

    bin.writeUInt32LE(obj.id, off); off += 4;
    bin.writeUInt32LE(n, off); off += 4;
    bin.writeUInt32LE(lb.length, off); off += 4;
    bin.set(lb, off); off += lp;
    bin.writeFloatLE(obj.color[0], off); off += 4;
    bin.writeFloatLE(obj.color[1], off); off += 4;
    bin.writeFloatLE(obj.color[2], off); off += 4;

    const posF32 = new Float32Array(bin.buffer, bin.byteOffset + off, n * 3);
    posF32.set(posData[i].positions);
    off += n * 3 * 4;

    const colF32 = new Float32Array(bin.buffer, bin.byteOffset + off, n * 3);
    const [cr, cg, cb] = obj.color;
    for (let j = 0; j < n; j++) {
      colF32[j * 3] = cr;
      colF32[j * 3 + 1] = cg;
      colF32[j * 3 + 2] = cb;
    }
    off += n * 3 * 4;
  }

  bin.writeUInt32LE(areas.length, off); off += 4;

  for (const a of areas) {
    const lb = enc.encode(a.roomLabel);
    const lp = Math.ceil(lb.length / 4) * 4;

    bin.writeUInt32LE(a.id, off); off += 4;
    bin.writeUInt32LE(lb.length, off); off += 4;
    bin.set(lb, off); off += lp;
    for (let k = 0; k < 3; k++) bin.writeFloatLE(a.boxMin[k], off), off += 4;
    for (let k = 0; k < 3; k++) bin.writeFloatLE(a.boxMax[k], off), off += 4;
    for (let k = 0; k < 3; k++) bin.writeFloatLE(a.center[k], off), off += 4;
    for (let k = 0; k < 3; k++) bin.writeFloatLE(a.color[k], off), off += 4;
    bin.writeUInt32LE(a.neighborIds.length, off); off += 4;
    for (const nid of a.neighborIds) {
      bin.writeUInt32LE(nid, off); off += 4;
    }
  }

  return bin;
}

function main() {
  const snapshotDir = findLatestSnapshot();
  if (!snapshotDir) {
    console.error("No snapshot found in", SAVED_DIR);
    process.exit(1);
  }
  const snapName = snapshotDir.split("/").pop()!;
  console.log(`Snapshot: ${snapName}`);

  const root = JSON.parse(readFileSync(join(snapshotDir, "scene_graph.json"), "utf-8"));
  const objects = extractObjects(root, snapshotDir);
  const areas = extractAreas(root);
  console.log(`Objects with PCD: ${objects.length}`);
  console.log(`Areas: ${areas.length}`);

  const posData = objects.map((obj) => readPCDPositions(obj.cloudPath));
  const totalPts = posData.reduce((s, p) => s + p.count, 0);
  console.log(`Total points: ${totalPts}`);

  const bin = buildBinary(objects, posData, areas);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "scene.bin"), bin);
  console.log(`Written: scene.bin (${(bin.length / 1024).toFixed(1)} KB)`);

  const manifest = {
    snapshot: snapName,
    objectCount: objects.length,
    areaCount: areas.length,
    totalPoints: totalPts,
    objects: objects.map((obj, i) => ({
      id: obj.id, label: obj.label, pointCount: posData[i].count, color: obj.color,
    })),
    areas: areas.map((a) => ({
      id: a.id, roomLabel: a.roomLabel, neighborCount: a.neighborIds.length, color: a.color,
    })),
  };
  writeFileSync(join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log("Written: manifest.json");
  console.log("Done.");
}

main();
