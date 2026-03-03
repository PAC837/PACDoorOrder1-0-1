# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PAC Door Order is a pipeline for parsing CNC door definitions from Mozaik CAM software, building relational graphs, exporting to optimizer XML, and visualizing doors in 3D with interactive tool visibility. It targets cabinet door manufacturers using Mozaik CNC routers.

## Repository Structure

Two separate packages share no runtime code but are connected by JSON data files:

- **Root package (`src/`)** — TypeScript library that parses Mozaik `.dat` XML files, validates with Zod schemas, builds relational graphs linking doors→operations→toolGroups→tools, and exports JSON + optimizer XML.
- **Viewer package (`viewer/`)** — React + Three.js app that loads the JSON output and renders interactive 3D door models with CSG boolean subtraction to carve CNC tool profiles from a door slab.

Data flows one-way: `src/cli.ts` writes JSON to `output/`, which is copied to `viewer/public/data/` for the viewer to fetch at runtime. The viewer also has a server-side API (`viewer/server/`) that can dynamically parse door libraries on demand via `/api/load`.

## Commands

### Root package

```bash
npm run build          # tsc → dist/
npm run analyze        # tsx src/cli.ts — runs full parse/graph/export pipeline
npm run test           # vitest run (no test files currently exist)
npm run test:watch     # vitest (watch mode)
npm run lint           # tsc --noEmit
npm run viewer         # cd viewer && npm run dev
npm run viewer:build   # cd viewer && npm run build
```

### Viewer package (from `viewer/`)

```bash
npm run dev            # vite dev server (port 5173, auto-opens browser)
npm run build          # tsc && vite build
npm run preview        # vite preview (serve production build)
```

### Type-checking the viewer from root

```bash
cd viewer && npx tsc --noEmit
```

## Architecture Details

### Data Pipeline (src/)

```
Mozaik .dat files (XML)
  → parsers/ (fast-xml-parser + Zod validation)
  → normalizers/buildGraph.ts (resolve relational references: door → operation → toolGroup → tool)
  → normalizers/extractProfiles.ts (extract CNC tool cutting profiles from ToolShape)
  → normalizers/diffDoors.ts (structural comparison of door variants)
  → exporters/exportOptimizer.ts (Mozaik optimizer XML)
  → output/*.json + output/optimizer-export.xml
```

Schemas in `src/schemas/` define all data types with Zod. `shared.ts` has XML coercion helpers (`xmlNum`, `xmlBool`, `xmlStr`, `xmlId`) needed because Mozaik XML attributes are always strings.

### 3D Viewer (viewer/)

**Coordinate systems:**
- Mozaik: X = height, Y = width (origin at bottom-left of door)
- Scene (Three.js): X = width, Y = height (centered at origin)
- `geometry.ts` → `mozaikToScene()` handles the transform

**CSG carving** (`cuttingBodies.ts`):
- Starts with a `BoxGeometry` slab (door blank)
- Three tool types produce different cut volumes:
  - **Flat (downshear)**: `buildFramePocket()` — rectangular annulus via `ExtrudeGeometry` with hole
  - **Profile (isCNCDoor=true)**: `buildCrossSection()` + `buildRectangularSweep()` — 2D cross-section swept along rectangular toolpath with mitered corners
  - **V-bit (sharpCornerAngle > 0)**: same sweep path, triangular cross-section
- Each cut volume is subtracted from the slab using `three-bvh-csg` (Brush/Evaluator/SUBTRACTION)
- Sweep mesh uses `toNonIndexed()` for flat per-face normals (keeps V-bit faces sharp, roundover arcs true to shape)
- `three-bvh-csg` requires matching attributes (position, normal, uv) on both CSG operands

**Back-face tool handling:**
- `buildCrossSection(tool, profiles, thickness, flipSide=true)` positions the cross-section at the back face: `tipZ = -thickness/2 + entryDepth`, `surfaceZ = -thickness/2 - overshoot`
- `buildProfileCrossSection` uses `direction = surfaceZ >= tipZ ? 1 : -1` to flip Y for back profiles, with `clipLocalY = Math.abs(surfaceZ - tipZ)` to keep clipping correct
- The Y-flip reverses polygon winding (CCW→CW). `buildRectangularSweep` corrects this via a shoelace signed-area check, reversing CW cross-sections back to CCW
- `buildFramePocket` args are intentionally swapped for back tools (`surfaceZ, tipZ` instead of `tipZ, surfaceZ`) to keep ExtrudeGeometry depth positive

**Per-tool FlipSide:**
- Individual tool entries within a tool group can have `FlipSide: true`, meaning that tool operates on the **opposite face** from the operation's assigned face
- The effective face is computed via XOR: `effectiveFlipSide = operation.FlipSideOp !== tool.flipSide`
- In `cuttingBodies.ts`, the front tools loop uses `effectiveFlipSide = tool.flipSide ?? false` and the back tools loop uses `effectiveFlipSide = !(tool.flipSide ?? false)` (XOR with `true` since the operation is already back-face)
- `CrossSectionViewer.tsx` partitions tools across ALL operations by effective flip side rather than by operation-level `flipSideOp`
- `flipSide` is propagated through the data pipeline: `RawToolEntry.FlipSide` → `cli.ts` serialization → `doorGraphs.json` → viewer types

**Profile shapes** (`profileShape.ts`):
- `ptType 0` = straight line vertex
- `ptType 1` = filleted corner (data = radius in mm, sign = convex/concave)
- `ptType 2` = Mozaik sagitta arc (data = sagitta in mm, perpendicular distance from chord midpoint to arc midpoint; positive = arc curves left of travel, negative = right)
- `profileToLinePoints()` uses a two-phase approach: Phase 1 tessellates ptType=2 arcs via `tessellateArc()` (sagitta→radius formula: `r = (s² + halfChord²) / (2s)`), Phase 2 applies ptType=1 corner fillets via `filletPolygon()`
- `mirrorForFullTool()` mirrors a half-profile across x=0 for symmetric tools

**2D cross-section viewer** (`CrossSectionViewer.tsx`):
- Samples depth at 0.05mm resolution across a 152.4mm (6") slice centered on the toolpath boundary
- Uses `buildCrossSectionPoints()` WITHOUT flipSide for both front and back tools — this is intentional because `depth = halfThickness - minY` gives correct cutting depth regardless of face (profiles are symmetric via `fullTool=true`)
- Back profile rendering: `thickness - depth` converts depth-from-back to screen Y
- Exports DXF in R12 format for Vectric/AutoCAD compatibility

**Data loading** (`hooks/useDoorData.ts`):
- Fetches `doors.json`, `doorGraphs.json`, `profiles.json`, `toolGroups.json`, `tools.json` from `/data/`
- Filters to CNC doors only (Type=3 with RoutedLockedShape)
- Supports dynamic reload via `/api/load` when user switches libraries in the Admin panel

**Key constants:**
- `MATERIAL_THICKNESS = 19.05` mm (3/4" stock) in `types.ts`
- `SURFACE_OVERSHOOT = 1.0` mm in `cuttingBodies.ts` (prevents coincident-face CSG artifacts)

### Admin Panel & Server API (viewer/server/)

The viewer uses **Vite's built-in dev server** (port 5173) with a custom Vite plugin (`pacAdminPlugin` in `api-plugin.ts`) that registers API middleware. No separate Express/Fastify server.

**Current server API routes (`/api/config/*`)** — SQLite-backed configure system:
- `GET /api/config/matrix` — full door styles matrix with all param values
- `POST /api/config/styles` — create new door style
- `PATCH /api/config/styles/:id` — rename style
- `DELETE /api/config/styles/:id` — delete style
- `PUT /api/config/styles/:id/params/:key` — upsert parameter value
- `POST /api/config/styles/reorder` — reorder style columns
- `GET|POST /api/config/param-order` — get/save parameter display order
- `POST /api/parse` — parse raw XML strings sent from browser, writes JSON to `viewer/public/data/`

**Database** (`viewer/server/db.ts`): `better-sqlite3` SQLite database at `viewer/.pac-doorstyles.db` stores door style matrix with WAL mode.

**Config file** (`viewer/server/config.ts`): `.pac-config.json` persists folder paths, selected textures, param order.

**Pipeline** (`viewer/server/pipeline.ts`): Dynamically imports root package parsers from `dist/` with `?t=${Date.now()}` cache-busting so recompiled parsers load without Vite restart.

**File System Access API** (`viewer/src/utils/folderAccess.ts`): Folder picking, texture scanning, and library loading are handled entirely browser-side using the native File System Access API. Handles are persisted to IndexedDB. This replaced older server-side `/api/browse-folder`, `/api/load`, etc. routes.

The Admin panel UI (`AdminPanel.tsx`) provides folder configuration and texture swatches. Textures are auto-selected (first file per category) when scanned so the 3D viewer works immediately. The Canvas component stays mounted (hidden via `display: none`) during library switches to prevent WebGL context loss.

### Tool offset convention

`entryOffset` from Mozaik data is negated when used: `offset = -tool.entryOffset`. A positive result means the toolpath is outward from the panel edge; negative means inward.

### Generic Door feature

`viewer/src/utils/genericDoor.ts` → `buildGenericDoor()` creates doors with independently configurable front/back tool groups, depths, and stile/rail widths. Generates both `DoorData` (for rendering) and `DoorGraphData` (relational graph) from raw tool group/tool data. This is a viewer-side utility, not part of the root data pipeline.

The export function in `App.tsx` mirrors Y coordinates (`exportY = w - node.Y`) to convert from internal convention (Y=0 = left edge) to Mozaik convention (Y=0 = right edge). This applies to all operations uniformly (both front and back).

### Panel types (pocket / raised / glass)

`PanelType = 'pocket' | 'raised' | 'glass'` in `types.ts` controls front/back panel behavior in Generic Door mode:

- **Pocket** — standard recessed panel (user-specified depth)
- **Raised** — no pocket cut (effective depth = 0)
- **Glass** — full through-cut (effective depth = material thickness), renders a translucent glass pane

`computeEffectiveDepths()` in `App.tsx` maps panel types to depths. `GLASS_THICKNESS = 3.175` mm (1/8") in `types.ts`.

**3D rendering** (`CNCDoorSlab.tsx`): Glass pane is a translucent `BoxGeometry` positioned in the back rabbet groove (computed by `getBackRabbetDepth()` — minimum back-face flat tool depth). The pane extends 3/8" (9.525 mm) into the stile/rail frame as a lip.

**2D cross-section** (`CrossSectionViewer.tsx`): Glass pane drawn as a cyan-tinted rectangle at the rabbet position. Front+back depth capping prevents the clip path from self-intersecting where cuts overlap. DXF export includes a GLASS layer (cyan) with the glass pane outline.

**Props flow:** `App.tsx` → `frontPanelType`/`backPanelType` → `DoorViewer` → `CNCDoorSlab`, and `App.tsx` → `CrossSectionViewer`.

### Viewer components

- **`DoorEditorToolbar.tsx`** — the **Data Entry** area (labeled "Data Entry" at top). This is the main panel where users configure door parameters: finish/texture, panel type, style selection, edge profiles, back operations, door type, handle placement, and hinge settings. All numbered sections (1–9) for building a door order.
- **`ToolShapeViewer.tsx`** — standalone tab rendering tool profile shapes from `profiles.json` for visual inspection of CNC cutter geometry
- **`OperationOverlay.tsx`** — right-side panel with per-operation expand/collapse and per-tool visibility checkboxes, controlling `OperationVisibility` and `ToolVisibility` state in `App.tsx`
- **`CommitNumberInput.tsx`** — shared number input that only commits `onBlur` or Enter, avoiding expensive re-renders per keystroke. Selects all text `onFocus` for quick replacement. Used throughout HingePanel, HandlePanel, HingeAdvancedDialog, HandleAdvancedDialog, PanelSplitControls, ParamCell, GroupDepthListCell.
- **`HingePanel.tsx`** / **`HandlePanel.tsx`** — sub-panels rendered inside HingeAdvancedDialog / HandleAdvancedDialog
- **`PanelSplitControls.tsx`** — controls for split panel position and width
- **`ElevationViewer.tsx`** — 2D front elevation rendering with inline click-to-edit overlays for stile/rail widths, hinge positions, and handle elevation
- **`LayoutCustomizer.tsx`** — dashboard panel layout drag-to-resize customizer
- **`OrderListPanel.tsx`** — order list panel for managing door order line items

### Configure System

`ConfigurePanel.tsx` → `ConfigureMatrix.tsx` provides a SQLite-backed parameter matrix:
- **Columns** = named door styles (e.g. "S008 Shaker", "S012 Raised Panel")
- **Rows** = parameters defined in `viewer/src/configParams.ts` (`PARAM_DEFINITIONS`)
- **Values** persisted in `viewer/.pac-doorstyles.db` via `/api/config/*` routes
- Drag-and-drop column reordering via `@dnd-kit`
- Style editor dialog (`StyleEditorDialog.tsx`) for add/rename/delete/reorder

**Parameter types** (`configParams.ts`):
- `number` — numeric value with unit (mm/in), rendered as `CommitNumberInput`
- `checkbox-list` — multi-select from dynamic tool group options
- `fixed-checkbox-list` — multi-select from fixed option set
- `group-depth-list` — per-group depth values
- `boolean-radio` — Yes/No radio
- `auto-checkbox` — checkbox that auto-enables based on conditions
- `preset-checkbox` — checkbox with a named preset selection
- `texture-checkbox-list` — grouped texture file paths with category/brand hierarchy

**Hinge auto-count** — per-style configure params:
- `hinge3Trigger`, `hinge4Trigger`, `hinge5Trigger`, `hinge6Trigger` (mm height thresholds)
- `hingeEdgeDistance` (mm from edge to first/last hinge)
- `computeAutoHingeCount()` in `App.tsx` watches door height + selected style, auto-sets `hingeConfig.count` and `edgeDistance`

**Texture category filtering** — `textures` param (`texture-checkbox-list`) controls which category buttons appear in Data Entry toolbar. Empty list = raw + sanded only. Raw always shown. Active category defaults to Primed if available, else Raw.

**Texture auto-select** — when `AdminPanel` scans a textures folder (mount or folder browse), `autoSelectTextures()` auto-selects the first file per category so the 3D viewer shows textures immediately without manual swatch selection.

## Key Dependencies

- **Root:** `fast-xml-parser`, `zod`, `vitest`, `tsx`
- **Viewer:** `three` (0.179), `@react-three/fiber`, `@react-three/drei`, `three-bvh-csg` (0.0.18), `react` 18, `vite` 6
- **Viewer server:** `better-sqlite3` (SQLite for configure system), `@dnd-kit/core` + `@dnd-kit/sortable` (drag-and-drop reordering in ConfigureMatrix)

## Source Data

Mozaik `.dat` files are organized in two folders configured via the Admin panel:

**CNC Tools folder** (e.g. `Control Doors S008/`):
- `ToolGroups.dat` — tool groupings linking operations to tools with depth/offset
- `ToolLib.dat` — CNC tool definitions including cutting profiles

**Door Libraries folder** (e.g. `Control Doors S008/`):
- Each subfolder is a library (e.g. `Door Visualizer 1.0/`)
- Each library contains `Doors.dat` — door definitions with operations referencing tool groups

The CLI (`src/cli.ts`) reads all three files from hardcoded paths. The viewer's `/api/load` endpoint reads them dynamically based on Admin panel configuration.

## Git Workflow

**Branch strategy:** work on `dev`, merge to `main` when stable, then recreate `dev` from `main`.

**Commit message rules — write for a human reading the log, not a machine:**
- **Subject line** (first line): short imperative summary of *what changed and why*, max ~72 chars
  - Good: `Add reset button to elevation view for stile/rail defaults`
  - Good: `Fix back-face profile collapse when clipLocalY is negative`
  - Bad: `e06cb80` (a hash tells nothing)
  - Bad: `update` / `fix` / `changes` (too vague)
- **Body** (optional, separated by blank line): bullet points for non-obvious details, breaking changes, or context
- Use present-tense imperative: "Add", "Fix", "Remove", "Update" — not "Added" or "Adding"
- Group related changes in one commit; unrelated changes in separate commits
