# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PAC Door Order is a pipeline for parsing CNC door definitions from Mozaik CAM software, building relational graphs, exporting to optimizer XML, and visualizing doors in 3D with interactive tool visibility. It targets cabinet door manufacturers using Mozaik CNC routers.

## Repository Structure

Two separate packages share no runtime code but are connected by JSON data files:

- **Root package (`src/`)** — TypeScript library that parses Mozaik `.dat` XML files, validates with Zod schemas, builds relational graphs linking doors→operations→toolGroups→tools, and exports JSON + optimizer XML.
- **Viewer package (`viewer/`)** — React + Three.js app that loads the JSON output and renders interactive 3D door models with CSG boolean subtraction to carve CNC tool profiles from a door slab.

Data flows one-way: `src/cli.ts` writes JSON to `output/`, which is copied to `viewer/public/data/` for the viewer to fetch at runtime.

## Commands

### Root package

```bash
npm run build          # tsc → dist/
npm run analyze        # tsx src/cli.ts — runs full parse/graph/export pipeline
npm run test           # vitest run
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
- Fetches `doors.json`, `doorGraphs.json`, `profiles.json` from `/data/`
- Filters to CNC doors only (Type=3 with RoutedLockedShape)

**Key constants:**
- `MATERIAL_THICKNESS = 19.05` mm (3/4" stock) in `types.ts`
- `SURFACE_OVERSHOOT = 1.0` mm in `cuttingBodies.ts` (prevents coincident-face CSG artifacts)

### Tool offset convention

`entryOffset` from Mozaik data is negated when used: `offset = -tool.entryOffset`. A positive result means the toolpath is outward from the panel edge; negative means inward.

### Generic Door feature

`genericDoor.ts` → `buildGenericDoor()` creates doors with independently configurable front/back tool groups, depths, and stile/rail widths. Generates both `DoorData` (for rendering) and `DoorGraphData` (relational graph) from raw tool group/tool data.

The export function in `App.tsx` mirrors Y coordinates (`exportY = w - node.Y`) to convert from internal convention (Y=0 = left edge) to Mozaik convention (Y=0 = right edge). This applies to all operations uniformly (both front and back).

## Key Dependencies

- **Root:** `fast-xml-parser`, `zod`, `vitest`, `tsx`
- **Viewer:** `three` (0.179), `@react-three/fiber`, `@react-three/drei`, `three-bvh-csg` (0.0.18), `react` 18, `vite` 6

## Source Data

Mozaik `.dat` files live in `Control Doors S008/`. The CLI reads three files:
- `Door Visualizer 1.0/Doors.dat` — door library definitions
- `ToolGroups.dat` — tool groupings linking operations to tools with depth/offset
- `ToolLib.dat` — CNC tool definitions including cutting profiles
