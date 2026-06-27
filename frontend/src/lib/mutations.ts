import type { Mutations, MovePoly, EdgeRef, CreatePoly } from "./types";

export function emptyMutations(): Mutations {
  return {
    deletePolyIds: [],
    movePoly: [],
    removeEdges: [],
    addEdges: [],
    createPoly: [],
  };
}

export function mutationCount(m: Mutations): number {
  return (
    m.deletePolyIds.length +
    m.movePoly.length +
    m.removeEdges.length +
    m.addEdges.length +
    m.createPoly.length
  );
}

/** Deduplicate an edge key "minId_maxId" */
export function edgeKey(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

export function addDeletePoly(m: Mutations, id: number): Mutations {
  if (m.deletePolyIds.includes(id)) return m;
  const mp = shallowCopy(m);
  mp.deletePolyIds = [...mp.deletePolyIds, id];
  return mp;
}

export function addMovePoly(m: Mutations, mp: MovePoly): Mutations {
  const existing = m.movePoly.findIndex((x) => x.id === mp.id);
  const n = shallowCopy(m);
  if (existing >= 0) {
    n.movePoly = [...n.movePoly];
    n.movePoly[existing] = { ...mp };
  } else {
    n.movePoly = [...n.movePoly, { ...mp }];
  }
  return n;
}

export function addRemoveEdge(m: Mutations, e: EdgeRef): Mutations {
  const key = edgeKey(e.srcId, e.dstId);
  if (m.removeEdges.some((r) => edgeKey(r.srcId, r.dstId) === key)) return m;
  const n = shallowCopy(m);
  n.removeEdges = [...n.removeEdges, { ...e }];
  return n;
}

export function addAddEdge(m: Mutations, e: EdgeRef): Mutations {
  const key = edgeKey(e.srcId, e.dstId);
  if (m.addEdges.some((a) => edgeKey(a.srcId, a.dstId) === key)) return m;
  const n = shallowCopy(m);
  n.addEdges = [...n.addEdges, { ...e }];
  return n;
}

export function addCreatePoly(m: Mutations, cp: CreatePoly): Mutations {
  const n = shallowCopy(m);
  n.createPoly = [...n.createPoly, { ...cp }];
  return n;
}

function shallowCopy(m: Mutations): Mutations {
  return {
    deletePolyIds: [...m.deletePolyIds],
    movePoly: m.movePoly.map((x) => ({ ...x })),
    removeEdges: m.removeEdges.map((x) => ({ ...x })),
    addEdges: m.addEdges.map((x) => ({ ...x })),
    createPoly: m.createPoly.map((x) => ({ ...x })),
  };
}
