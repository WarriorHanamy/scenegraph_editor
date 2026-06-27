import type { PreprocessedObject, PreprocessedArea, PreprocessedPoly, TopologicalNode, TopologicalEdge, SceneData } from "./types";

export async function loadSceneBin(url: string): Promise<SceneData> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to load ${url}: ${resp.status}`);
  const buf = await resp.arrayBuffer();
  const v = new DataView(buf);
  if (v.getUint32(0, true) !== 0x5347444e) throw new Error("Bad magic");

  let off = 4;
  const objCount = v.getUint32(off, true); off += 4;
  const objects: PreprocessedObject[] = [];

  for (let i = 0; i < objCount; i++) {
    const id = v.getUint32(off, true); off += 4;
    const N = v.getUint32(off, true); off += 4;
    const ll = v.getUint32(off, true); off += 4;
    const lp = Math.ceil(ll / 4) * 4;
    const label = new TextDecoder().decode(new Uint8Array(buf, off, ll)); off += lp;
    const cr = v.getFloat32(off, true); off += 4;
    const cg = v.getFloat32(off, true); off += 4;
    const cb = v.getFloat32(off, true); off += 4;
    const fatherPolyId = v.getUint32(off, true); off += 4;
    const cx = v.getFloat32(off, true); off += 4;
    const cy = v.getFloat32(off, true); off += 4;
    const cz = v.getFloat32(off, true); off += 4;
    const pos = new Float32Array(buf, off, N * 3); off += N * 12;
    const col = new Float32Array(buf, off, N * 3); off += N * 12;
    objects.push({ id, label, pointCount: N, colorHex: hex(cr, cg, cb), fatherPolyId,
      center: [cx, cy, cz], positions: pos, colors: col });
  }

  const areaCount = v.getUint32(off, true); off += 4;
  const areas: PreprocessedArea[] = [];
  for (let i = 0; i < areaCount; i++) {
    const id = v.getUint32(off, true); off += 4;
    const ll = v.getUint32(off, true); off += 4;
    const lp = Math.ceil(ll / 4) * 4;
    const rl = new TextDecoder().decode(new Uint8Array(buf, off, ll)); off += lp;
    const bmn: [number,number,number] = [v.getFloat32(off,true),v.getFloat32(off+4,true),v.getFloat32(off+8,true)]; off += 12;
    const bmx: [number,number,number] = [v.getFloat32(off,true),v.getFloat32(off+4,true),v.getFloat32(off+8,true)]; off += 12;
    const ctr: [number,number,number] = [v.getFloat32(off,true),v.getFloat32(off+4,true),v.getFloat32(off+8,true)]; off += 12;
    const cr = v.getFloat32(off, true); off += 4;
    const cg = v.getFloat32(off, true); off += 4;
    const cb = v.getFloat32(off, true); off += 4;
    const nc = v.getUint32(off, true); off += 4;
    const nids: number[] = [];
    for (let j = 0; j < nc; j++) { nids.push(v.getUint32(off, true)); off += 4; }
    const pc = v.getUint32(off, true); off += 4;
    const pids: number[] = [];
    for (let j = 0; j < pc; j++) { pids.push(v.getUint32(off, true)); off += 4; }
    areas.push({ id, roomLabel: rl, colorHex: hex(cr, cg, cb), boxMin: bmn, boxMax: bmx, center: ctr, neighborIds: nids, polyIds: pids });
  }

  const polyCount = v.getUint32(off, true); off += 4;
  const polys: PreprocessedPoly[] = [];
  for (let i = 0; i < polyCount; i++) {
    const id = v.getUint32(off, true); off += 4;
    const areaId = v.getUint32(off, true); off += 4;
    const px = v.getFloat32(off, true); off += 4;
    const py = v.getFloat32(off, true); off += 4;
    const pz = v.getFloat32(off, true); off += 4;
    const cr = v.getFloat32(off, true); off += 4;
    const cg = v.getFloat32(off, true); off += 4;
    const cb = v.getFloat32(off, true); off += 4;
    const V = v.getUint32(off, true); off += 4;
    const positions = V > 0 ? new Float32Array(buf, off, V * 3) : new Float32Array(0);
    off += V * 12;
    const E = v.getUint32(off, true); off += 4;
    const edgeIndices = E > 0 ? new Uint32Array(buf, off, E * 2) : new Uint32Array(0);
    off += E * 8;
    const Ac = v.getUint32(off, true); off += 4;
    const adjacentPolyIds: number[] = [];
    for (let j = 0; j < Ac; j++) { adjacentPolyIds.push(v.getUint32(off, true)); off += 4; }
    const Gc = v.getUint32(off, true); off += 4;
    const gatewayNodeIds: number[] = [];
    for (let j = 0; j < Gc; j++) { gatewayNodeIds.push(v.getUint32(off, true)); off += 4; }
    polys.push({ id, areaId, colorHex: hex(cr, cg, cb), center: [px, py, pz], positions, edgeIndices, adjacentPolyIds, gatewayNodeIds });
  }

  const topoEdgeCount = v.getUint32(off, true); off += 4;
  const topoEdges: TopologicalEdge[] = [];
  for (let i = 0; i < topoEdgeCount; i++) {
    const srcId = v.getUint32(off, true); off += 4;
    const dstId = v.getUint32(off, true); off += 4;
    const length = v.getFloat32(off, true); off += 4;
    const sp: [number,number,number] = [v.getFloat32(off,true),v.getFloat32(off+4,true),v.getFloat32(off+8,true)]; off += 12;
    const dp: [number,number,number] = [v.getFloat32(off,true),v.getFloat32(off+4,true),v.getFloat32(off+8,true)]; off += 12;
    const sc: [number,number,number] = [v.getFloat32(off,true),v.getFloat32(off+4,true),v.getFloat32(off+8,true)]; off += 12;
    const dc: [number,number,number] = [v.getFloat32(off,true),v.getFloat32(off+4,true),v.getFloat32(off+8,true)]; off += 12;
    const crossArea = v.getUint8(off) === 1; off += 1;
    topoEdges.push({ srcId, dstId, length, srcPos: sp, dstPos: dp,
      srcColorHex: hex(sc[0], sc[1], sc[2]), dstColorHex: hex(dc[0], dc[1], dc[2]), crossArea });
  }

  const topoNodes: TopologicalNode[] = polys.map(p => ({
    id: p.id, areaId: p.areaId, position: p.center, colorHex: p.colorHex,
  }));

  return { objects, areas, polys, topoNodes, topoEdges };
}

function hex(r: number, g: number, b: number): string {
  const t = (x: number) => ((x * 255) | 0).toString(16).padStart(2, "0");
  return `#${t(r)}${t(g)}${t(b)}`;
}
