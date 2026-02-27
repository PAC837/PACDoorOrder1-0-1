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
  hasMidRail = false,
  midRailPos = 381,         // mm from bottom to center of mid-rail
  midRailW = 76.2,          // 3" bar width
  hasMidStile = false,
  midStilePos = 254,        // mm from left to center of mid-stile
  midStileW = 76.2,         // 3" bar width
): { door: DoorData; graph: DoorGraphData } {
  // Look up maps
  const toolGroupById = new Map(allToolGroups.map((g) => [g.ToolGroupID, g]));
  const toolById = new Map(allTools.map((t) => [t.ToolID, t]));

  // Compute sub-panel rectangles in Mozaik coords (X=height, Y=width)
  // Full panel bounds
  const panelXMin = bottomRailW;
  const panelXMax = doorH - topRailW;
  const panelYMin = leftStileW;
  const panelYMax = doorW - rightStileW;

  // Vertical splits (mid-rail splits height into bottom/top)
  const xSplits: [number, number][] = [];
  if (hasMidRail) {
    const railHalf = midRailW / 2;
    xSplits.push([panelXMin, midRailPos - railHalf]);
    xSplits.push([midRailPos + railHalf, panelXMax]);
  } else {
    xSplits.push([panelXMin, panelXMax]);
  }

  // Horizontal splits (mid-stile splits width into left/right)
  const ySplits: [number, number][] = [];
  if (hasMidStile) {
    const stileHalf = midStileW / 2;
    ySplits.push([panelYMin, midStilePos - stileHalf]);
    ySplits.push([midStilePos + stileHalf, panelYMax]);
  } else {
    ySplits.push([panelYMin, panelYMax]);
  }

  // Build sub-panel toolpath rectangles (grid of xSplits × ySplits)
  const subPanelPaths: ToolPathNodeData[][] = [];
  for (const [xMin, xMax] of xSplits) {
    for (const [yMin, yMax] of ySplits) {
      subPanelPaths.push([
        { X: xMin, Y: yMax, DepthOR: -9999, PtType: 0, Data: 0 },
        { X: xMin, Y: yMin, DepthOR: -9999, PtType: 0, Data: 0 },
        { X: xMax, Y: yMin, DepthOR: -9999, PtType: 0, Data: 0 },
        { X: xMax, Y: yMax, DepthOR: -9999, PtType: 0, Data: 0 },
      ]);
    }
  }

  // Build operations — one per sub-panel per face
  const operations: OperationData[] = [];
  const graphOperations: DoorGraphData['operations'] = [];
  let nextId = 1;

  if (frontGroupId !== null) {
    const group = toolGroupById.get(frontGroupId);
    if (group) {
      for (const pathNodes of subPanelPaths) {
        operations.push({
          ID: nextId,
          ToolGroupID: frontGroupId,
          Depth: frontDepth,
          FlipSideOp: false,
          ClosedShape: true,
          InsideOut: true,
          CCW: false,
          OperationToolPathNode: pathNodes,
        });
        graphOperations.push(buildGraphOperation(nextId, group, toolById, frontDepth, false));
        nextId++;
      }
    }
  }

  if (backGroupId !== null) {
    const group = toolGroupById.get(backGroupId);
    if (group) {
      for (const pathNodes of subPanelPaths) {
        operations.push({
          ID: nextId,
          ToolGroupID: backGroupId,
          Depth: backDepth,
          FlipSideOp: true,
          ClosedShape: true,
          InsideOut: true,
          CCW: false,
          OperationToolPathNode: pathNodes,
        });
        graphOperations.push(buildGraphOperation(nextId, group, toolById, backDepth, true));
        nextId++;
      }
    }
  }

  // MainSection metadata
  const isSplit = hasMidRail || hasMidStile;

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
    CenterStileW: midStileW,
    CenterRailW: midRailW,
    PanelRecess: frontDepth,
    MainSection: {
      IsSplitSection: isSplit,
      X: leftStileW,
      Y: bottomRailW,
      DX: doorW - leftStileW - rightStileW,
      DY: doorH - topRailW - bottomRailW,
      SplitType: hasMidRail ? 1 : undefined,
      Dividers: hasMidRail
        ? { Divider: [{ DB: midRailW, DBStart: midRailPos - midRailW / 2 }] }
        : undefined,
      SubPanels: isSplit ? buildSubPanels(xSplits, ySplits) : undefined,
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

/** Build SubPanels metadata from splits. */
function buildSubPanels(
  xSplits: [number, number][],
  ySplits: [number, number][],
): { SubPanel: import('../types.js').SubPanelData[] } {
  const panels: import('../types.js').SubPanelData[] = [];
  for (const [xMin, xMax] of xSplits) {
    for (const [yMin, yMax] of ySplits) {
      const h = xMax - xMin;
      const w = yMax - yMin;
      panels.push({
        DA: h,
        Panel: { X: yMin, Y: xMin, DX: w, DY: h },
      });
    }
  }
  return { SubPanel: panels };
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
      flipSide: entry.FlipSide,
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
