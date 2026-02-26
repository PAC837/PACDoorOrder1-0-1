import { useMemo } from 'react';
import * as THREE from 'three';
import type { OperationData, DoorGraphData, ToolProfileData, ToolVisibility } from '../types.js';
import { toolPathToRect } from '../utils/geometry.js';
import { buildCarvedDoor } from '../utils/cuttingBodies.js';

interface CNCDoorSlabProps {
  doorW: number;
  doorH: number;
  thickness: number;
  frontOps: OperationData[];
  backPocketOp?: OperationData;
  graph?: DoorGraphData;
  profiles: ToolProfileData[];
  frontVisible?: boolean;
  backPocketVisible?: boolean;
  toolVisibility?: ToolVisibility;
  color?: string;
}

/**
 * Renders a CNC door as a single carved slab using CSG boolean subtraction.
 * Tool profiles from the ToolGroup entries are swept along the toolpath
 * and subtracted from a solid slab to create the profiled door geometry.
 */
export function CNCDoorSlab({
  doorW,
  doorH,
  thickness,
  frontOps,
  backPocketOp,
  graph,
  profiles,
  frontVisible = true,
  backPocketVisible = true,
  toolVisibility = {},
  color = '#B8834A',
}: CNCDoorSlabProps) {
  // Stable key that changes when tool selection changes — forces mesh re-mount
  const meshKey = useMemo(() => {
    const hidden = Object.entries(toolVisibility)
      .filter(([, v]) => v === false)
      .map(([k]) => k)
      .sort()
      .join(',');
    return `slab-${frontVisible}-${backPocketVisible}-${hidden}`;
  }, [toolVisibility, frontVisible, backPocketVisible]);

  const carvedGeo = useMemo(() => {
    // Build toolpath rects + associated tool entries from graph
    const toolpathRects: { rect: ReturnType<typeof toolPathToRect>; tools: DoorGraphData['operations'][0]['tools']; depth?: number }[] = [];

    if (frontVisible && graph) {
      for (const op of frontOps) {
        if (!op.OperationToolPathNode || op.OperationToolPathNode.length < 3) continue;
        const rect = toolPathToRect(op.OperationToolPathNode, doorW, doorH);

        // Find the matching graph operation to get tool entries
        const graphOp = graph.operations.find((go) => go.operationId === op.ID);
        if (graphOp) {
          const visibleTools = graphOp.tools.filter((_, ti) => {
            const key = `${graphOp.operationId}-${ti}`;
            return toolVisibility[key] !== false;
          });

          console.log(
            `[CNCDoorSlab] Op ${graphOp.operationId}: ${visibleTools.length}/${graphOp.tools.length} tools visible`,
            visibleTools.map((t) => t.toolName),
          );

          if (visibleTools.length > 0) {
            toolpathRects.push({ rect, tools: visibleTools, depth: op.Depth });
          }
        }
      }
    }

    // Back pocket — extract tools from graph just like front operations
    let backPocket: { rect: ReturnType<typeof toolPathToRect>; depth: number; tools: DoorGraphData['operations'][0]['tools'] } | null = null;
    if (backPocketVisible && backPocketOp?.OperationToolPathNode && backPocketOp.OperationToolPathNode.length >= 3) {
      const graphBackOp = graph?.operations.find((go) => go.operationId === backPocketOp.ID);
      const backTools = graphBackOp
        ? graphBackOp.tools.filter((_, ti) => {
            const key = `${graphBackOp.operationId}-${ti}`;
            return toolVisibility[key] !== false;
          })
        : [];

      backPocket = {
        rect: toolPathToRect(backPocketOp.OperationToolPathNode, doorW, doorH),
        depth: backPocketOp.Depth,
        tools: backTools,
      };
    }

    if (toolpathRects.length === 0 && !backPocket) {
      console.log('[CNCDoorSlab] No visible tools — returning plain slab');
      return new THREE.BoxGeometry(doorW, doorH, thickness);
    }

    try {
      const geo = buildCarvedDoor(doorW, doorH, thickness, toolpathRects, profiles, backPocket);
      console.log(`[CNCDoorSlab] Carved geometry: ${geo.attributes.position.count} vertices`);
      return geo;
    } catch (e) {
      console.error('[CNCDoorSlab] CSG FAILED:', e);
      return new THREE.BoxGeometry(doorW, doorH, thickness);
    }
  }, [doorW, doorH, thickness, frontOps, backPocketOp, graph, profiles, frontVisible, backPocketVisible, toolVisibility]);

  return (
    <mesh key={meshKey} geometry={carvedGeo}>
      <meshStandardMaterial color={color} roughness={0.7} side={THREE.DoubleSide} />
    </mesh>
  );
}
