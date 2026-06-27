# Scene Graph Editor

Web-based 3D topology editor for scene graph snapshots. View/delete topological nodes and create/delete topological edges.

## Quick Start

```bash
bun install
bun run dev
```

Opens at `http://localhost:5173`.

## Data Pipeline

```
scene_graph_saved/<snapshot>/   ← immutable source
    scene_graph.json
    manifest.json
    objects/*.pcd

        │ tools/preprocess.ts
        ▼

frontend/public/data/scene.bin  →  web 3D viewer/editor

        │ user edits (CRUD)
        ▼

export ──► backend applies mutations
        │
        ▼

scene_graph_exported/<snapshot>/   ← export target (overwritten)
    scene_graph.json
    manifest.json
    objects/*.pcd

        │ tools/preprocess.ts --from exported
        ▼

scene.bin regenerated → web reloads
```

- `scene_graph_saved/` — never modified by the editor
- `scene_graph_exported/` — export destination, created/overwritten on export

## Web CRUD — Topological Nodes & Edges

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
| Export  | Apply mutations → write to scene_graph_exported → regenerate scene.bin → reload |

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
- Object point clouds, area boxes, area edges/centers
- Polyhedra as points, wireframe, or mesh (with opacity)
- Topo nodes, topo edges
- Object→Poly edges

Entering edit mode temporarily renders only Topo Nodes and Topo Edges. Leaving
edit mode restores the previous view-layer configuration.

## Preprocessing

Regenerate `scene.bin` manually:

```bash
# From saved (default)
bun run preprocess

# From exported
bun run tools/preprocess.ts --from exported
```

## Project Structure

```
scenegraph_editor/
├── backend/
│   └── api-plugin.ts          # Vite plugin: POST /api/export mutation engine
├── frontend/
│   ├── src/
│   │   ├── App.tsx            # Editor state, click handler, keyboard
│   │   ├── lib/
│   │   │   ├── types.ts       # SceneData, Mutations, Export types
│   │   │   ├── mutations.ts   # Mutation tracking utilities
│   │   │   └── scene-loader.ts # Binary deserializer
│   │   └── components/
│   │       ├── EditToolbar.tsx      # Edit/Reset/Export bar
│   │       ├── TopologicalNodes.tsx # Node rendering + selection highlights
│   │       ├── TopologicalEdges.tsx # Edge rendering + selection highlight
│   │       └── ...                 # Other visual components
│   └── public/data/
│       ├── scene.bin                # Preprocessed binary (auto-generated)
│       └── manifest.json
├── tools/
│   └── preprocess.ts          # JSON → binary preprocessor
├── scene_graph_saved/         # Immutable source data
├── scene_graph_exported/      # Export target (gitignored)
└── package.json
```
