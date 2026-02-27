import { useMemo } from 'react';
import * as THREE from 'three';
import type { OperationData, DoorGraphData, ToolProfileData, ToolVisibility, PanelType } from '../types.js';
import { GLASS_THICKNESS } from '../types.js';
import { toolPathToRect } from '../utils/geometry.js';
import { buildCarvedDoor } from '../utils/cuttingBodies.js';

/** Extract the back rabbet depth (min back-face flat tool depth, excluding through-cuts). */
function getBackRabbetDepth(graph: DoorGraphData | undefined, thickness: number): number {
  if (!graph) return 0;
  let minDepth = Infinity;
  for (const op of graph.operations) {
    for (const tool of op.tools) {
      const effectiveBack = op.flipSideOp !== (tool.flipSide ?? false);
      if (effectiveBack && !tool.isCNCDoor && tool.sharpCornerAngle === 0 && tool.entryDepth < thickness) {
        minDepth = Math.min(minDepth, tool.entryDepth);
      }
    }
  }
  return minDepth === Infinity ? 0 : minDepth;
}

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
  frontPanelType?: PanelType;
  backPanelType?: PanelType;
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
  frontPanelType,
  backPanelType,
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

  // Glass pane — shown when either panel type is 'glass'
  const showGlass = frontPanelType === 'glass' || backPanelType === 'glass';
  const glassData = useMemo(() => {
    if (!showGlass) return null;
    const firstOp = frontOps[0];
    if (!firstOp?.OperationToolPathNode || firstOp.OperationToolPathNode.length < 3) return null;
    const rect = toolPathToRect(firstOp.OperationToolPathNode, doorW, doorH);
    // Glass sits in the back rabbet groove, extending 3/8" into stile/rail
    const backRabbet = getBackRabbetDepth(graph, thickness);
    const glassLip = 9.525; // 3/8" overlap into stile/rail frame
    const glassZ = backRabbet > 0
      ? -thickness / 2 + backRabbet - GLASS_THICKNESS / 2
      : 0;
    return {
      geometry: new THREE.BoxGeometry(rect.width + 2 * glassLip, rect.height + 2 * glassLip, GLASS_THICKNESS),
      position: [rect.x, rect.y, glassZ] as [number, number, number],
    };
  }, [showGlass, frontOps, doorW, doorH, graph, thickness]);

  return (
    <>
      <mesh key={meshKey} geometry={carvedGeo}>
        <meshStandardMaterial color={color} roughness={0.7} side={THREE.DoubleSide} />
      </mesh>
      {showGlass && glassData && (
        <mesh geometry={glassData.geometry} position={glassData.position}>
          <meshStandardMaterial
            color="#88ccff"
            transparent
            opacity={0.3}
            roughness={0.05}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
    </>
  );
}
