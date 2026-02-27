import * as THREE from 'three';
import type { DoorData, DoorGraphData, OperationVisibility, ToolProfileData, ToolVisibility, PanelType, HoleData } from '../types.js';
import { MATERIAL_THICKNESS } from '../types.js';
import { CNCDoorSlab } from './CNCDoorSlab.js';
import { toolPathToRect } from '../utils/geometry.js';

interface DoorViewerProps {
  door: DoorData;
  graph?: DoorGraphData;
  profiles: ToolProfileData[];
  operationVisibility: OperationVisibility;
  toolVisibility: ToolVisibility;
  frontPanelType?: PanelType;
  backPanelType?: PanelType;
  hasBackRabbit?: boolean;
  selectedPanelIdx?: number | null;
  onPanelSelect?: (idx: number | null) => void;
}

export function DoorViewer({ door, graph, profiles, operationVisibility, toolVisibility, frontPanelType, backPanelType, hasBackRabbit, selectedPanelIdx, onPanelSelect }: DoorViewerProps) {
  const operations = door.RoutedLockedShape?.Operations?.OperationPocket ?? [];
  const holes: HoleData[] = door.RoutedLockedShape?.Operations?.OperationHole ?? [];

  // Separate front profile ops from back pocket ops
  const frontOps = operations.filter((op) => !op.FlipSideOp);
  const backPocketOp = operations.find((op) => op.FlipSideOp);

  // Check visibility from overlay toggles
  const frontVisible = frontOps.some(
    (op) => operationVisibility[op.ID] === true
  );
  const backPocketVisible = backPocketOp
    ? operationVisibility[backPocketOp.ID] === true
    : false;

  const thickness = MATERIAL_THICKNESS;
  const doorW = door.DefaultW;
  const doorH = door.DefaultH;

  return (
    <group>
      <CNCDoorSlab
        doorW={doorW}
        doorH={doorH}
        thickness={thickness}
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
        holes={holes}
      />

      {/* Clickable panel overlays for mid-rail/stile interaction */}
      {onPanelSelect && frontOps.map((op, i) => {
        if (!op.OperationToolPathNode || op.OperationToolPathNode.length < 3) return null;
        const rect = toolPathToRect(op.OperationToolPathNode, doorW, doorH);
        const isSelected = selectedPanelIdx === i;
        return (
          <mesh
            key={`panel-select-${i}`}
            position={[rect.x, rect.y, thickness / 2 + 0.5]}
            onClick={(e) => { e.stopPropagation(); onPanelSelect(i); }}
            onPointerOver={() => { document.body.style.cursor = 'pointer'; }}
            onPointerOut={() => { document.body.style.cursor = 'default'; }}
          >
            <planeGeometry args={[rect.width, rect.height]} />
            <meshStandardMaterial
              color={isSelected ? '#4488ff' : '#ffffff'}
              transparent
              opacity={isSelected ? 0.25 : 0.0}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
        );
      })}
    </group>
  );
}
