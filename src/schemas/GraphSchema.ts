import type { LibraryDoor, OperationPocket } from './DoorSchema.js';
import type { ToolGroup, ToolEntry } from './ToolGroupSchema.js';
import type { Tool } from './ToolSchema.js';

/** A ToolEntry with its referenced Tool object attached. */
export interface ResolvedToolEntry {
  entry: ToolEntry;
  tool: Tool;
}

/** A ToolGroup with all its ToolEntry tools resolved. */
export interface ResolvedToolGroup {
  group: ToolGroup;
  tools: ResolvedToolEntry[];
}

/** An OperationPocket with its ToolGroup resolved. */
export interface ResolvedOperation {
  operation: OperationPocket;
  toolGroup: ResolvedToolGroup;
}

/** A fully resolved door with all operations linked to their tool chains. */
export interface ResolvedDoor {
  door: LibraryDoor;
  operations: ResolvedOperation[];
}

/** Lookup maps built from parsed data for graph resolution. */
export interface ToolLookupMaps {
  toolById: Map<number, Tool>;
  toolGroupById: Map<number, ToolGroup>;
}
