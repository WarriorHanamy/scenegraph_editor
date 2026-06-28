# Scene Graph Editor

Web-based 3D topology editor for scene graph snapshots. View/delete topological nodes and create/delete topological edges.

## Installation

Install Bun if needed:

```bash
curl -fsSL https://bun.sh/install | bash
```

Then install project dependencies:

```bash
bun install
```

## Quick Start

```bash
bun run dev
```

Opens at `http://localhost:5173`.

## Filesystem Contract

```
scenegraph_editor/
├── backend/                     # Vite API plugin (express-style middleware)
├── frontend/                    # React + R3F web editor
├── scene_graph_saved/           # Immutable source snapshots (gitignored)
│   └── <snapshot>/
│       ├── scene_graph.json     # areas, polyhedrons, vertices, edges, facets, objects
│       ├── manifest.json        # metadata: saved_at, summary counters
│       └── objects/             # optional per-object data files
├── scene_graph_exported/        # Export target (gitignored)
│   └── <snapshot>/
│       ├── scene_graph.json     # mutation result, written by POST /api/export
│       └── manifest.json        # regenerated on export
└── package.json
```

- **`scene_graph_saved/`** — never modified by the editor; treated as read-only canonical data.
- **`scene_graph_exported/`** — export destination, created or overwritten on each `POST /api/export`.
- **API read priority**: `GET /api/scene-graph` serves from `exported/` first, falls back to `saved/`.
- **Snapshot naming convention**: `J30V2_whole-<YYYYMMDD>-<idx>`

## CLI Commands

| Command        | Description                                      |
| -------------- | ------------------------------------------------ |
| `bun run dev`  | Start Vite dev server on port 5173               |

### API Endpoints

| Method | Endpoint                          | Description                                       |
| ------ | --------------------------------- | ------------------------------------------------- |
| `GET`  | `/api/snapshot`                   | Returns the latest snapshot name                  |
| `GET`  | `/api/snapshots`                  | Lists all available snapshots with metadata       |
| `GET`  | `/api/scene-graph?snapshot=X`     | Serves `scene_graph.json` (exported first, then saved) |
| `POST` | `/api/export`                     | Applies mutations and writes result to `scene_graph_exported/` |

`/api/scene-graph` accepts optional `?source=saved` or `?source=exported` to force a specific source.

## Data Pipeline

### Read & Render

```
scene_graph_saved/<snapshot>/         ← immutable source on disk
    scene_graph.json                      (areas, polyhedrons, vertices, edges...)

        │ GET /api/scene-graph?snapshot=X
        ▼

backend/api-plugin.ts                 ← serves JSON (checks exported/ first, falls back to saved/)
        │
        ▼

loadSceneGraph()  (browser-side)      ← frontend/src/lib/scene-loader.ts
        │
        ├── parse vertices[]  → vertex position + connectivity map
        ├── parse areas[]     → PreprocessedArea[]  (boxes, colors, neighborIds)
        ├── parse polyhedrons[] + vertices[]
        │       └──  PreprocessedPoly[]  (positions, wireframe edgeIndices,
        │                                 adjacentPolyIds, gatewayNodeIds)
        ├── derive topoNodes  (poly centers → TopologicalNode[])
        └── derive topoEdges  (adjacentPolyIds + gatewayNodeIds → TopologicalEdge[])
        │
        ▼

    SceneData  { areas, polys, topoNodes, topoEdges }
        │
        ├──► AreaBoxes / AreaEdges / AreaCenters   (area layer)
        ├──► PolyhedraAll / PolyMesh               (poly layer)
        └──► TopologicalNodes / TopologicalEdges   (topo graph)
```

### Export

```
Browser editor state                  ← mutations tracked in History<Mutations>
        │
        │ POST /api/export { snapshot, mutations }
        ▼

backend/api-plugin.ts
        │
        ├── readFileSync(scene_graph_saved/<snapshot>/scene_graph.json)
        ├── applyMutations(root, mutations)
        │     deletePoly / movePoly / removeEdges / addEdges / createPoly
        ├── writeFileSync(scene_graph_exported/<snapshot>/scene_graph.json)
        │
        ▼

    { success: true }
        │
        ▼

Frontend reloads:
    GET /api/scene-graph?snapshot=X
    (server checks scene_graph_exported/ first, falls back to scene_graph_saved/)
        │
        ▼

    loadSceneGraph() re-parses → re-renders
```

### Overview

```
scene_graph_saved/<snapshot>/scene_graph.json     ← immutable source
        │
        │ browser loads + parses (via API)
        ▼
   3D viewer / editor
        │
        │ user edits → export
        ▼
   POST /api/export → backend applies mutations
        │
        ▼
scene_graph_exported/<snapshot>/scene_graph.json  ← exported result
        │
        │ browser reloads (API serves exported/ version)
        ▼
   3D viewer (shows exported result)
```

- `scene_graph_saved/` — never modified by the editor
- `scene_graph_exported/` — export destination, created/overwritten on export
- Data flow no longer requires PCD files or binary preprocessing

## Web UI — Topological Nodes & Edges

Click **Edit** in the top toolbar to enter editing mode.

### Selection

| Action       | How                              |
| ------------ | -------------------------------- |
| Select node  | Click a node sphere              |
| Multi-select | Shift/Ctrl/Cmd+click additional nodes |
| Select edge  | Click on a line between nodes    |
| Deselect all | Click empty space or press `Esc` |

### Node Operations

| Operation  | Key / Action                   | Result                             |
| ---------- | ------------------------------ | ---------------------------------- |
| Delete     | Select node(s) then `Delete`   | Removes poly + all connected edges |

### Edge Operations

| Operation  | Key / Action                   | Result                             |
| ---------- | ------------------------------ | ---------------------------------- |
| Create     | Select 2 nodes then `E`        | Adds bidirectional adjacency edge  |
| Delete     | Select edge then `Delete`      | Removes adjacency from both ends   |

### Toolbar

| Button  | Action                                                         |
| ------- | -------------------------------------------------------------- |
| Edit    | Toggle edit mode on/off                                        |
| Reset   | Discard all changes, reload from scene_graph_saved             |
| Export  | POST /api/export → apply mutations → write to scene_graph_exported → reload |

The toolbar shows a change count when there are unsaved mutations.

### Keyboard Shortcuts (edit mode only)

| Key      | Action                                |
| -------- | ------------------------------------- |
| `Delete` / `Backspace` | Delete selected node(s) or edge       |
| `E`        | Connect two selected nodes with an edge |
| `Esc`      | Clear all selections                  |
| `Ctrl+Z`   | Undo the previous edit                 |
| `Ctrl+R`   | Redo the previously undone edit        |

## Layers Panel

Toggle visibility of 3D elements in the right-side panel:
- Area boxes, area edges, area centers
- Polyhedra as points, wireframe, or mesh (with opacity slider)
- Topo nodes, topo edges

Entering edit mode temporarily renders only Topo Nodes and Topo Edges. Leaving
edit mode restores the previous view-layer configuration.

## Project Structure

```
scenegraph_editor/
├── backend/
│   └── api-plugin.ts          # Vite plugin: /api/export + /api/scene-graph + /api/snapshot
├── frontend/
│   ├── src/
│   │   ├── App.tsx            # Editor state, click handler, keyboard
│   │   ├── lib/
│   │   │   ├── types.ts       # SceneData, Mutations, Export types
│   │   │   ├── mutations.ts   # Mutation tracking utilities
│   │   │   └── scene-loader.ts # JSON → SceneData parser
│   │   └── components/
│   │       ├── EditToolbar.tsx        # Edit/Reset/Export bar
│   │       ├── TopologicalNodes.tsx   # Node spheres + selection highlights
│   │       ├── TopologicalEdges.tsx   # Edge lines + selection highlight
│   │       ├── AreaBoxes.tsx          # Area bounding-box wireframes
│   │       ├── AreaEdges.tsx          # Area→Area adjacency lines
│   │       ├── AreaCenters.tsx        # Area center spheres
│   │       ├── PolyhedraAll.tsx       # Poly vertex points + wireframe
│   │       └── PolyMesh.tsx           # Poly convex hull (transparent)
├── scene_graph_saved/         # Immutable source data
├── scene_graph_exported/      # Export target (gitignored)
└── package.json
```
