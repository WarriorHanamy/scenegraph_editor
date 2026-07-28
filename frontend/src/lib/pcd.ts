export interface ParsedCloud {
  positions: Float32Array;
  count: number;
}

/**
 * Load and parse an ASCII PCD point cloud.
 */
export async function loadSceneCloud(url: string): Promise<ParsedCloud> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to load ${url}: ${resp.status}`);
  const text = await resp.text();

  const dataIdx = text.search(/^DATA\s+ascii\s*$/m);
  if (dataIdx < 0) throw new Error("PCD: only ascii DATA is supported");

  const header = text.slice(0, dataIdx);
  const fields =
    header
      .match(/^FIELDS\s+(.+)$/m)?.[1]
      .trim()
      .split(/\s+/) ?? [];
  const xi = fields.indexOf("x");
  const yi = fields.indexOf("y");
  const zi = fields.indexOf("z");
  if (xi < 0 || yi < 0 || zi < 0) throw new Error("PCD: missing x/y/z fields");

  const body = text.slice(text.indexOf("\n", dataIdx) + 1);
  const lines = body.split("\n");

  const positions = new Float32Array(lines.length * 3);
  let out = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length <= Math.max(xi, yi, zi)) continue;
    const x = Number(parts[xi]);
    const y = Number(parts[yi]);
    const z = Number(parts[zi]);
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) continue;
    positions[out * 3] = x;
    positions[out * 3 + 1] = y;
    positions[out * 3 + 2] = z;
    out++;
  }

  const finalPositions = positions.subarray(0, out * 3) as Float32Array;
  return { positions: finalPositions, count: out };
}
