import type { PreprocessedObject, PreprocessedArea, SceneData } from "./types";

/**
 * Parse scene.bin binary format (LE).
 *
 * Layout:
 *   [u32] magic
 *   [u32] objCount
 *   For each object: [u32] id, [u32] pointCount, [u32] labelLen, [u8*] label, [f32*3] color,
 *                    [f32*pointCount*3] positions, [f32*pointCount*3] colors
 *   [u32] areaCount
 *   For each area: [u32] id, [u32] labelLen, [u8*] roomLabel, [f32*3] boxMin, [f32*3] boxMax,
 *                  [f32*3] center, [f32*3] color, [u32] neighborCount, [u32*] neighborIds
 */
export async function loadSceneBin(url: string): Promise<SceneData> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to load ${url}: ${resp.status}`);
  const buf = await resp.arrayBuffer();
  const view = new DataView(buf);

  const magic = view.getUint32(0, true);
  if (magic !== 0x5347444e) throw new Error(`Bad magic: 0x${magic.toString(16)}`);

  const objCount = view.getUint32(4, true);
  let off = 8;
  const objects: PreprocessedObject[] = [];

  for (let i = 0; i < objCount; i++) {
    const id = view.getUint32(off, true); off += 4;
    const pointCount = view.getUint32(off, true); off += 4;
    const labelLen = view.getUint32(off, true); off += 4;
    const rl = Math.ceil(labelLen / 4) * 4;
    const label = new TextDecoder().decode(new Uint8Array(buf, off, labelLen));
    off += rl;
    const r = view.getFloat32(off, true); off += 4;
    const g = view.getFloat32(off, true); off += 4;
    const b = view.getFloat32(off, true); off += 4;

    const posBytes = pointCount * 3 * 4;
    const positions = new Float32Array(buf, off, pointCount * 3);
    off += posBytes;

    const colBytes = pointCount * 3 * 4;
    const colors = new Float32Array(buf, off, pointCount * 3);
    off += colBytes;

    objects.push({
      id, label, pointCount,
      colorHex: rgbHex(r, g, b),
      positions, colors,
    });
  }

  const areaCount = view.getUint32(off, true); off += 4;
  const areas: PreprocessedArea[] = [];

  for (let i = 0; i < areaCount; i++) {
    const id = view.getUint32(off, true); off += 4;
    const labelLen = view.getUint32(off, true); off += 4;
    const rl = Math.ceil(labelLen / 4) * 4;
    const roomLabel = new TextDecoder().decode(new Uint8Array(buf, off, labelLen));
    off += rl;

    const boxMin: [number, number, number] = [
      view.getFloat32(off, true), view.getFloat32(off + 4, true), view.getFloat32(off + 8, true),
    ]; off += 12;
    const boxMax: [number, number, number] = [
      view.getFloat32(off, true), view.getFloat32(off + 4, true), view.getFloat32(off + 8, true),
    ]; off += 12;
    const center: [number, number, number] = [
      view.getFloat32(off, true), view.getFloat32(off + 4, true), view.getFloat32(off + 8, true),
    ]; off += 12;
    const cr = view.getFloat32(off, true); off += 4;
    const cg = view.getFloat32(off, true); off += 4;
    const cb = view.getFloat32(off, true); off += 4;

    const neighborCount = view.getUint32(off, true); off += 4;
    const neighborIds: number[] = [];
    for (let j = 0; j < neighborCount; j++) {
      neighborIds.push(view.getUint32(off, true)); off += 4;
    }

    areas.push({
      id, roomLabel,
      colorHex: rgbHex(cr, cg, cb),
      boxMin, boxMax, center, neighborIds,
    });
  }

  return { objects, areas };
}

function rgbHex(r: number, g: number, b: number): string {
  const toHex = (v: number) => ((v * 255) | 0).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
