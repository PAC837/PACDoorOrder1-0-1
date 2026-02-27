import type { DoorData, DoorGraphData, OperationVisibility, ToolProfileData, ToolVisibility, PanelType } from '../types.js';
import { MATERIAL_THICKNESS } from '../types.js';
import { CNCDoorSlab } from './CNCDoorSlab.js';

interface DoorViewerProps {
  door: DoorData;
  graph?: DoorGraphData;
  profiles: ToolProfileData[];
  operationVisibility: OperationVisibility;
  toolVisibility: ToolVisibility;
  frontPanelType?: PanelType;
  backPanelType?: PanelType;
  hasBackRabbit?: boolean;
}

export function DoorViewer({ door, graph, profiles, operationVisibility, toolVisibility, frontPanelType, backPanelType, hasBackRabbit }: DoorViewerProps) {
  const operations = door.RoutedLockedShape?.Operations?.OperationPocket ?? [];

  // Separate front profile ops (TG 70) from back pocket op (TG 58)
  const frontOps = operations.filter((op) => !op.FlipSideOp);
  const backPocketOp = operations.find((op) => op.FlipSideOp);

  // Check visibility from overlay toggles
  const frontVisible = frontOps.some(
    (op) => operationVisibility[op.ID] === true
  );
  const backPocketVisible = backPocketOp
    ? operationVisibility[backPocketOp.ID] === true
    : false;

  return (
    <CNCDoorSlab
      doorW={door.DefaultW}
      doorH={door.DefaultH}
      thickness={MATERIAL_THICKNESS}
      frontOps={frontOps}
      backPocketOp={backPocketOp}
      graph={graph}
      profiles={profiles}
      frontVisible={frontVisible}
      backPocketVisible={backPocketVisible}
      toolVisibility={toolVisibility}
      frontPanelType={frontPanelType}
      backPanelType={backPanelType}
      hasBackRabbit={hasBackRabbit}
    />
  );
}
