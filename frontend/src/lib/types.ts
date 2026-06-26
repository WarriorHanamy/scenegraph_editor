export interface Area {
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

export interface ObjectEdge {
  child_object_ids: number[];
  edge_description: string;
  father_object_id: number;
}

export interface Object3DData {
  id: number;
  label: string;
  color: [number, number, number];
  edge: ObjectEdge;
  files: {
    cloud?: string;
    obb_axis?: string;
    obb_corners?: string;
  };
  pos?: [number, number, number];
}

export interface SceneGraphSnapshot {
  areas: Area[];
  objects: Object3DData[];
  counters: {
    area_count: number;
    object_count: number;
  };
  save_name?: string;
}

export interface Manifest {
  format_version: number;
  save_name: string;
  saved_at: string;
  summary: {
    area_count: number;
    object_count: number;
    poly_count: number;
    saved_cloud_num: number;
  };
}
