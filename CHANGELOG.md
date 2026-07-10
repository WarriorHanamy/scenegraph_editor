# Changelog

## [unreleased] — 2026-07-10

### Added

- **Unity-style camera controls.**  Replaced drei `OrbitControls` with a custom
  controller (`UnityCameraControls.tsx`) that supports:
  - **Right-drag** FPS look-around (yaw/pitch)
  - **Right-drag + WASD** fly-through movement
  - **Right-drag + Q / E** vertical move
  - **Right-drag + Shift** speed boost (3x)
  - **Right-drag + Scroll** flight-speed adjustment
  - **Alt + Left-drag** orbit around pivot
  - **Middle-drag** pan (truck)
  - **Scroll** dolly (zoom toward pivot)
  - **F** frame the entire scene
  - Zero damping — behaviour matches Unity Scene view.
  - Dual-view sync in the export-diff panel now uses the same controller.

- **`focusBox` prop** on `UnityCameraControls`.  The `Scene` component computes
  a world-space bounding box from `SceneData` (respecting the
  `rotation[-PI/2,0,0]` group transform) and provides it to the controller so
  that **F** always frames the whole scene.

### Changed

- **`App.tsx`:**  `OrbitControls` → `UnityCameraControls`.  Selection logic
  (left-click in edit mode) is unaffected.
- **`ExportDiffPanel.tsx`:**  `SyncedControls` now holds a
  `UnityCameraControlsHandle` ref instead of an `OrbitControls` ref; camera
  sync reads/writes `position` + `quaternion` + `target` identically.
- **`README.md`:**  Added Camera Controls section, updated Project Structure
  listing.

### Fixed

- **Euler-angle argument order** in FPS quaternion rebuild
  (`UnityCameraControls.tsx:264`).  `Euler(pitch, yaw, 0, "YXZ")` — the `x`
  parameter is pitch, `y` is yaw.  Previously swapped, causing an immediate
  orientation flip (black screen) when right-clicking.
