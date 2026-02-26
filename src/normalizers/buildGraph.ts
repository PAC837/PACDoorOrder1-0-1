import type { LibraryDoor } from '../schemas/DoorSchema.js';
import type { ToolGroup } from '../schemas/ToolGroupSchema.js';
import type { Tool } from '../schemas/ToolSchema.js';
import type {
  ResolvedDoor,
  ResolvedOperation,
  ResolvedToolGroup,
  ResolvedToolEntry,
  ToolLookupMaps,
} from '../schemas/GraphSchema.js';

/**
 * Build lookup maps from flat parsed arrays.
 */
export function buildLookupMaps(
  tools: Tool[],
  toolGroups: ToolGroup[]
): ToolLookupMaps {
  const toolById = new Map<number, Tool>();
  for (const tool of tools) {
    toolById.set(tool.ToolID, tool);
  }

  const toolGroupById = new Map<number, ToolGroup>();
  for (const group of toolGroups) {
    toolGroupById.set(group.ToolGroupID, group);
  }

  return { toolById, toolGroupById };
}

/**
 * Resolve a single ToolGroup's ToolEntries to their Tool objects.
 */
export function resolveToolGroup(
  group: ToolGroup,
  toolById: Map<number, Tool>
): ResolvedToolGroup {
  const tools: ResolvedToolEntry[] = group.ToolEntry.map((entry) => {
    const tool = toolById.get(entry.ToolID);
    if (!tool) {
      throw new Error(
        `Tool ID ${entry.ToolID} referenced by ToolGroup "${group.Name}" ` +
        `(ID: ${group.ToolGroupID}) not found in ToolLibrary`
      );
    }
    return { entry, tool };
  });
  return { group, tools };
}

/**
 * Resolve a door's operations to their ToolGroups and Tools.
 */
export function resolveDoor(
  door: LibraryDoor,
  maps: ToolLookupMaps
): ResolvedDoor {
  const operations: ResolvedOperation[] = [];

  const ops = door.RoutedLockedShape?.Operations?.OperationPocket ?? [];
  for (const operation of ops) {
    const group = maps.toolGroupById.get(operation.ToolGroupID);
    if (!group) {
      throw new Error(
        `ToolGroup ID ${operation.ToolGroupID} referenced by operation ` +
        `ID ${operation.ID} in door "${door.Name}" not found`
      );
    }
    const toolGroup = resolveToolGroup(group, maps.toolById);
    operations.push({ operation, toolGroup });
  }

  return { door, operations };
}

/**
 * Resolve all doors into a full relational graph.
 */
export function buildGraph(
  doors: LibraryDoor[],
  tools: Tool[],
  toolGroups: ToolGroup[]
): ResolvedDoor[] {
  const maps = buildLookupMaps(tools, toolGroups);
  return doors.map((door) => resolveDoor(door, maps));
}
