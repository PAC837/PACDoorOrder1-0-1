import { useMemo, useEffect, useState } from 'react';
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { OperationData, DoorGraphData, ToolProfileData, ToolVisibility, PanelType, HoleData, RenderMode } from '../types.js';
import { GLASS_THICKNESS } from '../types.js';
import { toolPathToRect } from '../utils/geometry.js';
import { buildCarvedDoor, getBackRabbetDepth } from '../utils/cuttingBodies.js';

interface CNCDoorSlabProps {
  doorW: number;
  doorH: number;
  thickness: number;
  frontOps: OperationData[];
  backPocketOps?: OperationData[];
  graph?: DoorGraphData;
  profiles: ToolProfileData[];
  frontVisible?: boolean;
  backPocketVisible?: boolean;
  toolVisibility?: ToolVisibility;
  color?: string;
  frontPanelType?: PanelType;
  backPanelType?: PanelType;
  hasBackRabbit?: boolean;
  holes?: HoleData[];
  renderMode?: RenderMode;
  textureUrl?: string;
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
  backPocketOps = [],
  graph,
  profiles,
  frontVisible = true,
  backPocketVisible = true,
  toolVisibility = {},
  color = '#B8834A',
  frontPanelType,
  backPanelType,
  hasBackRabbit,
  holes = [],
  renderMode = 'ghosted',
  textureUrl,
}: CNCDoorSlabProps) {
  // Stable key that changes when tool selection changes — forces mesh re-mount
  const meshKey = useMemo(() => {
    const hidden = Object.entries(toolVisibility)
      .filter(([, v]) => v === false)
      .map(([k]) => k)
      .sort()
      .join(',');
    return `slab-${frontVisible}-${backPocketVisible}-${hidden}-h${holes.length}-bp${backPocketOps.length}`;
  }, [toolVisibility, frontVisible, backPocketVisible, holes, backPocketOps]);

  // Load texture from URL when provided
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    if (!textureUrl) {
      setTexture(null);
      return;
    }
    const loader = new THREE.TextureLoader();
    const tex = loader.load(textureUrl, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      setTexture(t);
    });
    return () => {
      tex.dispose();
    };
  }, [textureUrl]);

  const carvedGeo = useMemo(() => {
    // Build toolpath rects + associated tool entries from graph
    const toolpathRects: { rect: ReturnType<typeof toolPathToRect>; tools: DoorGraphData['operations'][0]['tools']; depth?: number; alignment?: number }[] = [];

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

          if (visibleTools.length > 0) {
            toolpathRects.push({ rect, tools: visibleTools, depth: op.Depth, alignment: graphOp.alignment });
          }
        }
      }
    }

    // Back pockets — extract tools from graph for each back operation
    const backPockets: { rect: ReturnType<typeof toolPathToRect>; depth: number; tools: DoorGraphData['operations'][0]['tools']; alignment?: number }[] = [];
    if (backPocketVisible) {
      for (const bop of backPocketOps) {
        if (!bop.OperationToolPathNode || bop.OperationToolPathNode.length < 3) continue;
        const graphBackOp = graph?.operations.find((go) => go.operationId === bop.ID);
        const backTools = graphBackOp
          ? graphBackOp.tools.filter((_, ti) => {
              const key = `${graphBackOp.operationId}-${ti}`;
              return toolVisibility[key] !== false;
            })
          : [];

        backPockets.push({
          rect: toolPathToRect(bop.OperationToolPathNode, doorW, doorH),
          depth: bop.Depth,
          tools: backTools,
          alignment: graphBackOp?.alignment ?? 1,
        });
      }
    }

    if (toolpathRects.length === 0 && backPockets.length === 0 && holes.length === 0) {
      return new THREE.BoxGeometry(doorW, doorH, thickness);
    }

    try {
      return buildCarvedDoor(doorW, doorH, thickness, toolpathRects, profiles, backPockets, holes);
    } catch (e) {
      console.error('[CNCDoorSlab] CSG FAILED:', e);
      return new THREE.BoxGeometry(doorW, doorH, thickness);
    }
  }, [doorW, doorH, thickness, frontOps, backPocketOps, graph, profiles, frontVisible, backPocketVisible, toolVisibility, holes]);

  // Glass pane — shown when either panel type is 'glass'
  const showGlass = frontPanelType === 'glass' || backPanelType === 'glass';
  const glassData = useMemo(() => {
    if (!showGlass) return null;
    const firstOp = frontOps[0];
    if (!firstOp?.OperationToolPathNode || firstOp.OperationToolPathNode.length < 3) return null;
    const rect = toolPathToRect(firstOp.OperationToolPathNode, doorW, doorH);
    // Glass sits in the back rabbet groove, extending 3/8" into stile/rail
    const backRabbet = hasBackRabbit !== false ? getBackRabbetDepth(graph, thickness) : 0;
    const glassLip = hasBackRabbit !== false ? 9.525 : 0; // 3/8" lip only with back rabbit
    const glassZ = backRabbet > 0
      ? -thickness / 2 + backRabbet - GLASS_THICKNESS / 2
      : 0;
    return {
      geometry: new THREE.BoxGeometry(rect.width + 2 * glassLip, rect.height + 2 * glassLip, GLASS_THICKNESS),
      position: [rect.x, rect.y, glassZ] as [number, number, number],
    };
  }, [showGlass, frontOps, doorW, doorH, graph, thickness, hasBackRabbit]);

  // EdgesGeometry for wireframe mode — mergeVertices fixes CSG boundary artifacts
  const edgesGeo = useMemo(() => {
    if (renderMode !== 'wireframe') return null;
    const merged = mergeVertices(carvedGeo, 1e-3);
    merged.computeVertexNormals();
    return new THREE.EdgesGeometry(merged, 30);
  }, [carvedGeo, renderMode]);

  return (
    <>
      {renderMode === 'wireframe' ? (
        <>
          {edgesGeo && (
            <lineSegments key={`${meshKey}-wire`} geometry={edgesGeo}>
              <lineBasicMaterial color={color} />
            </lineSegments>
          )}
        </>
      ) : (
        <mesh key={meshKey} geometry={carvedGeo}>
          <meshStandardMaterial
            key={`mat-${renderMode}-${textureUrl ?? 'none'}`}
            color={texture ? '#ffffff' : color}
            map={texture ?? undefined}
            roughness={0.7}
            side={THREE.DoubleSide}
            transparent={renderMode === 'ghosted'}
            opacity={renderMode === 'ghosted' ? 0.4 : 1}
            depthWrite={renderMode !== 'ghosted'}
          />
        </mesh>
      )}
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
