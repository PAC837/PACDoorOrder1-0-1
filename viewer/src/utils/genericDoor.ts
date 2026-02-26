import type {
  DoorData,
  DoorGraphData,
  RawToolGroup,
  RawTool,
  OperationData,
  ToolPathNodeData,
} from '../types.js';

/**
 * Build a synthetic DoorData + DoorGraphData from user-selected tool groups.
 *
 * The caller passes effective depths directly:
 *   - Depth > 0 → pocket is routed, then tools carve profiles.
 *   - Depth = 0 → one-piece: NO pocket, but tools still carve decorative profiles.
 *
 * Stile/rail widths are fully independent (left, right, top, bottom).
 */
export function buildGenericDoor(
  allToolGroups: RawToolGroup[],
  allTools: RawTool[],
  frontGroupId: number | null,
  backGroupId: number | null,
  frontDepth: number,
  backDepth: number,
  doorW = 508,              // 20"
  doorH = 762,              // 30"
  leftStileW = 63.5,        // 2.5"
  rightStileW = 63.5,       // 2.5"
  topRailW = 63.5,          // 2.5"
  bottomRailW = 63.5,       // 2.5"
): { door: DoorData; graph: DoorGraphData } {
  // Look up maps
  const toolGroupById = new Map(allToolGroups.map((g) => [g.ToolGroupID, g]));
  const toolById = new Map(allTools.map((t) => [t.ToolID, t]));

  // Toolpath rectangle nodes (Mozaik coords: X=height, Y=width)
  const pathNodes: ToolPathNodeData[] = [
    { X: bottomRailW,      Y: doorW - rightStileW, DepthOR: -9999, PtType: 0, Data: 0 },
    { X: bottomRailW,      Y: leftStileW,          DepthOR: -9999, PtType: 0, Data: 0 },
    { X: doorH - topRailW, Y: leftStileW,          DepthOR: -9999, PtType: 0, Data: 0 },
    { X: doorH - topRailW, Y: doorW - rightStileW, DepthOR: -9999, PtType: 0, Data: 0 },
  ];

  // Build operations
  const operations: OperationData[] = [];
  const graphOperations: DoorGraphData['operations'] = [];

  if (frontGroupId !== null) {
    const group = toolGroupById.get(frontGroupId);
    if (group) {
      operations.push({
        ID: 1,
        ToolGroupID: frontGroupId,
        Depth: frontDepth,
        FlipSideOp: false,
        ClosedShape: true,
        InsideOut: true,
        CCW: false,
        OperationToolPathNode: pathNodes,
      });
      graphOperations.push(buildGraphOperation(1, group, toolById, frontDepth, false));
    }
  }

  if (backGroupId !== null) {
    const group = toolGroupById.get(backGroupId);
    if (group) {
      operations.push({
        ID: 2,
        ToolGroupID: backGroupId,
        Depth: backDepth,
        FlipSideOp: true,
        ClosedShape: true,
        InsideOut: true,
        CCW: false,
        OperationToolPathNode: pathNodes,
      });
      graphOperations.push(buildGraphOperation(2, group, toolById, backDepth, true));
    }
  }

  const door: DoorData = {
    Name: 'Generic Door',
    Type: 3,
    DefaultW: doorW,
    DefaultH: doorH,
    HasTopRail: true,
    HasBottomRail: true,
    HasLeftStile: true,
    HasRightStile: true,
    TopRailW: topRailW,
    BottomRailW: bottomRailW,
    LeftRightStileW: leftStileW,
    CenterStileW: 76.2,
    CenterRailW: 76.2,
    PanelRecess: frontDepth,
    MainSection: {
      IsSplitSection: false,
      X: leftStileW,
      Y: bottomRailW,
      DX: doorW - leftStileW - rightStileW,
      DY: doorH - topRailW - bottomRailW,
    },
    RoutedLockedShape: {
      Operations: {
        OperationPocket: operations,
      },
    },
  };

  const graph: DoorGraphData = {
    doorName: 'Generic Door',
    doorType: 3,
    operationCount: graphOperations.length,
    operations: graphOperations,
  };

  return { door, graph };
}

function buildGraphOperation(
  operationId: number,
  group: RawToolGroup,
  toolById: Map<number, RawTool>,
  depth: number,
  flipSideOp: boolean,
): DoorGraphData['operations'][0] {
  const tools = group.ToolEntry.map((entry) => {
    const tool = toolById.get(entry.ToolID);
    return {
      toolId: entry.ToolID,
      toolName: tool?.Name ?? `Tool ${entry.ToolID}`,
      isCNCDoor: tool?.AppCNCDoor ?? false,
      toolDiameter: tool?.Dia ?? 6.35,
      sharpCornerAngle: tool?.SharpCornerAngle ?? 0,
      entryDepth: entry.Depth,
      entryOffset: entry.Offset,
    };
  });

  return {
    operationId,
    toolGroupId: group.ToolGroupID,
    toolGroupName: group.Name,
    depth,
    flipSideOp,
    toolCount: tools.length,
    tools,
  };
}
