export interface PreprocessedObject {
  id: number;
  label: string;
  pointCount: number;
  colorHex: string;
  positions: Float32Array;
  colors: Float32Array;
}

export interface PreprocessedArea {
  id: number;
  roomLabel: string;
  colorHex: string;
  /** center and box bounds in local space */
  boxMin: [number, number, number];
  boxMax: [number, number, number];
  center: [number, number, number];
  neighborIds: number[];
}

export interface SceneData {
  objects: PreprocessedObject[];
  areas: PreprocessedArea[];
}
