import type {
  DoorData,
  DoorGraphData,
  RawToolGroup,
  RawTool,
  OperationData,
  ToolPathNodeData,
  HoleData,
  BackPocketMode,
} from '../types.js';
import type { PanelTree, PanelBounds } from './panelTree.js';
import { flattenTree, enumerateSplits } from './panelTree.js';

/**
 * Build a synthetic DoorData + DoorGraphData from user-selected tool groups.
 *
 * The caller passes effective depths directly:
 *   - Depth > 0 → pocket is routed, then tools carve profiles.
 *   - Depth = 0 → one-piece: NO pocket, but tools still carve decorative profiles.
 *
 * Stile/rail widths are fully independent (left, right, top, bottom).
 * Panel splitting is controlled by the recursive PanelTree.
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
  panelTree: PanelTree = { type: 'leaf' },
  backPanelTree: PanelTree = { type: 'leaf' },
  holes: HoleData[] = [],
  backPocketMode: BackPocketMode = 'all',
  selectedPanelIndices: Set<number> = new Set(),
  edgeGroupId: number | null = null,
): { door: DoorData; graph: DoorGraphData; panelBounds: PanelBounds[] } {
  // Look up maps
  const toolGroupById = new Map(allToolGroups.map((g) => [g.ToolGroupID, g]));
  const toolById = new Map(allTools.map((t) => [t.ToolID, t]));

  // Root panel bounds (inside the frame)
  const rootBounds: PanelBounds = {
    xMin: bottomRailW,
    xMax: doorH - topRailW,
    yMin: leftStileW,
    yMax: doorW - rightStileW,
  };
  const panelBounds = flattenTree(panelTree, rootBounds);

  // Build sub-panel toolpath rectangles from flattened leaves
  const subPanelPaths: ToolPathNodeData[][] = [];
  for (const pb of panelBounds) {
    subPanelPaths.push([
      { X: pb.xMin, Y: pb.yMax, DepthOR: -9999, PtType: 0, Data: 0 },
      { X: pb.xMin, Y: pb.yMin, DepthOR: -9999, PtType: 0, Data: 0 },
      { X: pb.xMax, Y: pb.yMin, DepthOR: -9999, PtType: 0, Data: 0 },
      { X: pb.xMax, Y: pb.yMax, DepthOR: -9999, PtType: 0, Data: 0 },
    ]);
  }

  // Back-face panel bounds (independent tree)
  const backBounds = flattenTree(backPanelTree, rootBounds);
  const backSubPanelPaths: ToolPathNodeData[][] = [];
  for (const pb of backBounds) {
    backSubPanelPaths.push([
      { X: pb.xMin, Y: pb.yMax, DepthOR: -9999, PtType: 0, Data: 0 },
      { X: pb.xMin, Y: pb.yMin, DepthOR: -9999, PtType: 0, Data: 0 },
      { X: pb.xMax, Y: pb.yMin, DepthOR: -9999, PtType: 0, Data: 0 },
      { X: pb.xMax, Y: pb.yMax, DepthOR: -9999, PtType: 0, Data: 0 },
    ]);
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
      // Determine which toolpaths get back operations based on mode
      let backPaths: ToolPathNodeData[][];
      if (backPocketMode === 'full') {
        // Single rectangle covering entire frame area (ignoring splits)
        backPaths = [[
          { X: rootBounds.xMin, Y: rootBounds.yMax, DepthOR: -9999, PtType: 0, Data: 0 },
          { X: rootBounds.xMin, Y: rootBounds.yMin, DepthOR: -9999, PtType: 0, Data: 0 },
          { X: rootBounds.xMax, Y: rootBounds.yMin, DepthOR: -9999, PtType: 0, Data: 0 },
          { X: rootBounds.xMax, Y: rootBounds.yMax, DepthOR: -9999, PtType: 0, Data: 0 },
        ]];
      } else if (backPocketMode === 'selected' && selectedPanelIndices.size > 0) {
        backPaths = Array.from(selectedPanelIndices)
          .filter(idx => idx < backSubPanelPaths.length)
          .map(idx => backSubPanelPaths[idx]);
      } else {
        // 'all' — one back op per sub-panel (default)
        backPaths = backSubPanelPaths;
      }

      for (const pathNodes of backPaths) {
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

  // Edge operations — toolpath is the FULL DOOR PERIMETER
  if (edgeGroupId !== null) {
    const edgeGroup = toolGroupById.get(edgeGroupId);
    if (edgeGroup) {
      const perimeterNodes: ToolPathNodeData[] = [
        { X: 0,     Y: doorW, DepthOR: -9999, PtType: 0, Data: 0 },
        { X: 0,     Y: 0,     DepthOR: -9999, PtType: 0, Data: 0 },
        { X: doorH, Y: 0,     DepthOR: -9999, PtType: 0, Data: 0 },
        { X: doorH, Y: doorW, DepthOR: -9999, PtType: 0, Data: 0 },
      ];
      operations.push({
        ID: nextId,
        ToolGroupID: edgeGroupId,
        Depth: 0,
        FlipSideOp: false,
        ClosedShape: true,
        InsideOut: false,
        CCW: false,
        OperationToolPathNode: perimeterNodes,
      });
      graphOperations.push(buildGraphOperation(nextId, edgeGroup, toolById, 0, false));
      nextId++;
    }
  }

  // MainSection metadata
  const splits = enumerateSplits(panelTree);
  const hsplits = splits.filter((s) => s.type === 'hsplit');
  const isSplit = splits.length > 0;

  // Collect first-level divider widths for CenterRailW / CenterStileW
  const firstVsplit = splits.find((s) => s.type === 'vsplit');
  const firstHsplit = hsplits[0];

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
    // Mozaik has a single LeftRightStileW field; use average when L/R differ
    LeftRightStileW: (leftStileW + rightStileW) / 2,
    CenterStileW: firstVsplit?.width ?? 0,
    CenterRailW: firstHsplit?.width ?? 0,
    PanelRecess: frontDepth,
    MainSection: {
      IsSplitSection: isSplit,
      X: leftStileW,
      Y: bottomRailW,
      DX: doorW - leftStileW - rightStileW,
      DY: doorH - topRailW - bottomRailW,
      SplitType: hsplits.length > 0 ? 1 : undefined,
      Dividers: hsplits.length > 0
        ? { Divider: hsplits.map((s) => ({ DB: s.width, DBStart: s.pos - s.width / 2 })) }
        : undefined,
      SubPanels: isSplit ? buildSubPanelsFromBounds(panelBounds) : undefined,
    },
    RoutedLockedShape: {
      Operations: {
        OperationPocket: operations,
        ...(holes.length > 0 ? { OperationHole: holes } : {}),
      },
    },
  };

  const graph: DoorGraphData = {
    doorName: 'Generic Door',
    doorType: 3,
    operationCount: graphOperations.length,
    operations: graphOperations,
  };

  return { door, graph, panelBounds };
}

/** Build SubPanels metadata from flattened panel bounds. */
function buildSubPanelsFromBounds(
  bounds: PanelBounds[],
): { SubPanel: import('../types.js').SubPanelData[] } {
  const panels: import('../types.js').SubPanelData[] = [];
  for (const pb of bounds) {
    const h = pb.xMax - pb.xMin;
    const w = pb.yMax - pb.yMin;
    panels.push({
      DA: h,
      Panel: { X: pb.yMin, Y: pb.xMin, DX: w, DY: h },
    });
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
    alignment: group.Alignment,
    depth,
    flipSideOp,
    toolCount: tools.length,
    tools,
  };
}
