// Parsers
export { stripPrefix } from './parsers/stripPrefix.js';
export { parseDoors } from './parsers/parseDoors.js';
export { parseToolGroups } from './parsers/parseToolGroups.js';
export { parseToolLib } from './parsers/parseToolLib.js';
export { parseDoorExport } from './parsers/parseDoorExport.js';

// Normalizers
export { buildGraph, buildLookupMaps, resolveDoor, resolveToolGroup }
  from './normalizers/buildGraph.js';
export { extractProfiles } from './normalizers/extractProfiles.js';
export { diffDoors } from './normalizers/diffDoors.js';

// Types — Door
export type {
  LibraryDoor,
  MainSection,
  OperationPocket,
  OperationToolPathNode,
  ShapeAdjustment,
} from './schemas/DoorSchema.js';

// Types — Tool
export type { Tool, ToolShape } from './schemas/ToolSchema.js';

// Types — ToolGroup
export type { ToolGroup, ToolEntry } from './schemas/ToolGroupSchema.js';

// Types — ShapePoint
export type { ShapePoint } from './schemas/ShapePointSchema.js';

// Types — Graph
export type {
  ResolvedDoor,
  ResolvedOperation,
  ResolvedToolGroup,
  ResolvedToolEntry,
  ToolLookupMaps,
} from './schemas/GraphSchema.js';

// Types — Profile & Diff
export type {
  ToolProfile,
  ToolProfilePoint,
  DoorDiffResult,
  AttributeDiff,
  OperationDiff,
  SectionDiff,
} from './schemas/ProfileSchema.js';
