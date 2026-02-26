import type { LibraryDoor } from '../schemas/DoorSchema.js';
import type {
  DoorDiffResult,
  AttributeDiff,
  OperationDiff,
  SectionDiff,
} from '../schemas/ProfileSchema.js';

/** Top-level scalar keys to compare between two doors. */
const SCALAR_KEYS: (keyof LibraryDoor)[] = [
  'Name', 'Type', 'IsDrawerFront', 'DefaultW', 'DefaultH',
  'HasTopRail', 'HasBottomRail', 'HasLeftStile', 'HasRightStile',
  'TopRailW', 'BottomRailW', 'LeftRightStileW',
  'CenterStileW', 'CenterRailW', 'PanelRecess', 'DividerThickness',
  'IsBeaded', 'IsLongRails', 'IsAppliedDividers',
  'RoutedHasTopRail', 'RoutedHasBottomRail',
  'RoutedTopRailW', 'RoutedBottomRailW',
  'RoutedSpecialMullions', 'RoutedSpecialMullionWidth',
];

/**
 * Compare two LibraryDoor objects and produce a structured diff.
 * Detects attribute changes, operation additions/removals/modifications,
 * and structural section changes (split sections, dividers).
 */
export function diffDoors(a: LibraryDoor, b: LibraryDoor): DoorDiffResult {
  const attributeDiffs: AttributeDiff[] = [];
  const operationDiffs: OperationDiff[] = [];
  const sectionDiffs: SectionDiff[] = [];

  // Compare scalar attributes
  for (const key of SCALAR_KEYS) {
    const va = a[key];
    const vb = b[key];
    if (va !== vb) {
      attributeDiffs.push({ path: key, valueA: va, valueB: vb });
    }
  }

  // Compare MainSection structure
  if (a.MainSection.IsSplitSection !== b.MainSection.IsSplitSection) {
    sectionDiffs.push({
      type: 'changed',
      path: 'MainSection.IsSplitSection',
      details: `${a.MainSection.IsSplitSection} -> ${b.MainSection.IsSplitSection}`,
    });
  }

  // Compare Dividers
  const divsA = a.MainSection.Dividers?.Divider ?? [];
  const divsB = b.MainSection.Dividers?.Divider ?? [];
  if (divsA.length !== divsB.length) {
    sectionDiffs.push({
      type: divsB.length > divsA.length ? 'added' : 'removed',
      path: 'MainSection.Dividers',
      details: `${divsA.length} divider(s) -> ${divsB.length} divider(s)`,
    });
  }

  // Compare SubPanels
  const subsA = a.MainSection.SubPanels?.SubPanel ?? [];
  const subsB = b.MainSection.SubPanels?.SubPanel ?? [];
  if (subsA.length !== subsB.length) {
    sectionDiffs.push({
      type: subsB.length > subsA.length ? 'added' : 'removed',
      path: 'MainSection.SubPanels',
      details: `${subsA.length} sub-panel(s) -> ${subsB.length} sub-panel(s)`,
    });
  }

  // Compare operations
  const opsA = a.RoutedLockedShape?.Operations?.OperationPocket ?? [];
  const opsB = b.RoutedLockedShape?.Operations?.OperationPocket ?? [];
  const maxOps = Math.max(opsA.length, opsB.length);

  for (let i = 0; i < maxOps; i++) {
    const opA = opsA[i];
    const opB = opsB[i];
    if (!opA && opB) {
      operationDiffs.push({
        type: 'added',
        operationId: opB.ID,
        details: `ToolGroupID=${opB.ToolGroupID}, Depth=${opB.Depth}, FlipSideOp=${opB.FlipSideOp}`,
      });
    } else if (opA && !opB) {
      operationDiffs.push({
        type: 'removed',
        operationId: opA.ID,
        details: `ToolGroupID=${opA.ToolGroupID}, Depth=${opA.Depth}`,
      });
    } else if (opA && opB) {
      const diffs: string[] = [];
      if (opA.ToolGroupID !== opB.ToolGroupID)
        diffs.push(`ToolGroupID: ${opA.ToolGroupID} -> ${opB.ToolGroupID}`);
      if (opA.FlipSideOp !== opB.FlipSideOp)
        diffs.push(`FlipSideOp: ${opA.FlipSideOp} -> ${opB.FlipSideOp}`);
      if (opA.Depth !== opB.Depth)
        diffs.push(`Depth: ${opA.Depth} -> ${opB.Depth}`);
      if (opA.CCW !== opB.CCW)
        diffs.push(`CCW: ${opA.CCW} -> ${opB.CCW}`);
      if (opA.InsideOut !== opB.InsideOut)
        diffs.push(`InsideOut: ${opA.InsideOut} -> ${opB.InsideOut}`);
      if (diffs.length > 0) {
        operationDiffs.push({
          type: 'changed',
          operationId: opA.ID,
          details: diffs.join('; '),
        });
      }
    }
  }

  return { doorA: a.Name, doorB: b.Name, attributeDiffs, operationDiffs, sectionDiffs };
}
