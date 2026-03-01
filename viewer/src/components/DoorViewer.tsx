import { useMemo } from 'react';
import * as THREE from 'three';
import type { DoorData, DoorGraphData, OperationVisibility, ToolProfileData, ToolVisibility, PanelType, HoleData, RenderMode } from '../types.js';
import { MATERIAL_THICKNESS } from '../types.js';

import { CNCDoorSlab } from './CNCDoorSlab.js';
import { toolPathToRect } from '../utils/geometry.js';
import type { PanelTree, PanelBounds } from '../utils/panelTree.js';
import { enumerateSplitsWithBounds, pathsEqual } from '../utils/panelTree.js';

interface DoorViewerProps {
  door: DoorData;
  graph?: DoorGraphData;
  profiles: ToolProfileData[];
  operationVisibility: OperationVisibility;
  toolVisibility: ToolVisibility;
  frontPanelType?: PanelType;
  backPanelType?: PanelType;
  hasBackRabbit?: boolean;
  selectedPanelIndices?: Set<number>;
  onPanelSelect?: (idx: number, event: { ctrlKey: boolean }) => void;
  selectedSplitPath?: number[] | null;
  onSplitSelect?: (path: number[] | null) => void;
  panelTree?: PanelTree;
  thickness?: number;
  renderMode?: RenderMode;
  textureUrl?: string;
}

export function DoorViewer({ door, graph, profiles, operationVisibility, toolVisibility, frontPanelType, backPanelType, hasBackRabbit, selectedPanelIndices, onPanelSelect, selectedSplitPath, onSplitSelect, panelTree, thickness: thicknessProp, renderMode, textureUrl }: DoorViewerProps) {
  // Note: onPanelSelect/onSplitSelect may be undefined — overlays render read-only highlights when absent
  const operations = door.RoutedLockedShape?.Operations?.OperationPocket ?? [];
  const holes: HoleData[] = door.RoutedLockedShape?.Operations?.OperationHole ?? [];

  // Separate front profile ops from back ops (now an array for multi-panel support)
  const frontOps = operations.filter((op) => !op.FlipSideOp);
  const backPocketOps = operations.filter((op) => op.FlipSideOp);

  // Check visibility from overlay toggles
  const frontVisible = frontOps.some(
    (op) => operationVisibility[op.ID] === true
  );
  const backPocketVisible = backPocketOps.some(
    (op) => operationVisibility[op.ID] === true
  );

  const thickness = thicknessProp ?? MATERIAL_THICKNESS;
  const doorW = door.DefaultW;
  const doorH = door.DefaultH;

  // Compute split overlay data for divider highlights (and optional click targets)
  const splitOverlays = useMemo(() => {
    if (!panelTree) return [];
    const rootBounds: PanelBounds = {
      xMin: door.BottomRailW,
      xMax: door.DefaultH - door.TopRailW,
      yMin: door.LeftRightStileW,
      yMax: door.DefaultW - door.LeftRightStileW,
    };
    return enumerateSplitsWithBounds(panelTree, rootBounds);
  }, [panelTree, door.BottomRailW, door.TopRailW, door.LeftRightStileW, door.DefaultW, door.DefaultH]);

  return (
    <group>
      <CNCDoorSlab
        doorW={doorW}
        doorH={doorH}
        thickness={thickness}
        frontOps={frontOps}
        backPocketOps={backPocketOps}
        graph={graph}
        profiles={profiles}
        frontVisible={frontVisible}
        backPocketVisible={backPocketVisible}
        toolVisibility={toolVisibility}
        frontPanelType={frontPanelType}
        backPanelType={backPanelType}
        hasBackRabbit={hasBackRabbit}
        holes={holes}
        renderMode={renderMode}
        textureUrl={textureUrl}
      />

      {/* Panel selection highlights (read-only unless onPanelSelect is provided) */}
      {selectedPanelIndices && selectedPanelIndices.size > 0 && frontOps.map((op, i) => {
        if (!selectedPanelIndices.has(i)) return null;
        if (!op.OperationToolPathNode || op.OperationToolPathNode.length < 3) return null;
        const rect = toolPathToRect(op.OperationToolPathNode, doorW, doorH);
        return (
          <mesh
            key={`panel-select-${i}`}
            position={[rect.x, rect.y, thickness / 2 + 0.5]}
            {...(onPanelSelect ? {
              onClick: (e: THREE.Event) => { (e as any).stopPropagation(); onPanelSelect(i, { ctrlKey: (e as any).ctrlKey || (e as any).metaKey }); },
              onPointerOver: () => { document.body.style.cursor = 'pointer'; },
              onPointerOut: () => { document.body.style.cursor = 'default'; },
            } : {})}
          >
            <planeGeometry args={[rect.width, rect.height]} />
            <meshStandardMaterial
              color="#4488ff"
              transparent
              opacity={0.25}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
        );
      })}

      {/* Split selection highlights (read-only unless onSplitSelect is provided) */}
      {selectedSplitPath && splitOverlays.map((split, i) => {
        if (!pathsEqual(split.path, selectedSplitPath)) return null;
        const b = split.bounds;
        const sceneX = ((b.yMin + b.yMax) / 2) - doorW / 2;
        const sceneY = ((b.xMin + b.xMax) / 2) - doorH / 2;
        const width = b.yMax - b.yMin;
        const height = b.xMax - b.xMin;
        return (
          <mesh
            key={`split-select-${i}`}
            position={[sceneX, sceneY, thickness / 2 + 0.6]}
            {...(onSplitSelect ? {
              onClick: (e: THREE.Event) => { (e as any).stopPropagation(); onSplitSelect(split.path); },
              onPointerOver: () => { document.body.style.cursor = 'pointer'; },
              onPointerOut: () => { document.body.style.cursor = 'default'; },
            } : {})}
          >
            <planeGeometry args={[width, height]} />
            <meshStandardMaterial
              color="#ff8800"
              transparent
              opacity={0.3}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
        );
      })}
    </group>
  );
}
