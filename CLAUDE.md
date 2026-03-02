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

The viewer includes a Vite plugin (`api-plugin.ts`) that adds server-side API routes:

- **`/api/config`** (GET/POST) — persists two folder paths (CNC tools folder, door libraries folder) to `.pac-config.json`
- **`/api/validate-tools`** (POST) — checks for `ToolGroups.dat` + `ToolLib.dat` in CNC tools folder
- **`/api/validate-libraries`** (POST) — scans folder for subdirectories containing `Doors.dat`
- **`/api/libraries`** (GET) — lists available door libraries
- **`/api/load`** (POST) — dynamically parses a selected door library using the root package's compiled `dist/` parsers, writes JSON to `viewer/public/data/`, and returns the parsed data
- **`/api/browse-folder`** (POST) — opens a native Windows folder picker dialog via PowerShell

The pipeline (`pipeline.ts`) uses dynamic `import()` with cache-busting (`?t=${Date.now()}`) to load from `dist/` so that recompiled parsers take effect without restarting Vite.

The Admin panel UI (`AdminPanel.tsx`) provides folder configuration and a library selector dropdown. The Canvas component stays mounted (hidden via `display: none`) during library switches to prevent WebGL context loss.

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

## Key Dependencies

- **Root:** `fast-xml-parser`, `zod`, `vitest`, `tsx`
- **Viewer:** `three` (0.179), `@react-three/fiber`, `@react-three/drei`, `three-bvh-csg` (0.0.18), `react` 18, `vite` 6

## Source Data

Mozaik `.dat` files are organized in two folders configured via the Admin panel:

**CNC Tools folder** (e.g. `Control Doors S008/`):
- `ToolGroups.dat` — tool groupings linking operations to tools with depth/offset
- `ToolLib.dat` — CNC tool definitions including cutting profiles

**Door Libraries folder** (e.g. `Control Doors S008/`):
- Each subfolder is a library (e.g. `Door Visualizer 1.0/`)
- Each library contains `Doors.dat` — door definitions with operations referencing tool groups

The CLI (`src/cli.ts`) reads all three files from hardcoded paths. The viewer's `/api/load` endpoint reads them dynamically based on Admin panel configuration.
