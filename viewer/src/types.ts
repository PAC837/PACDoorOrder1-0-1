/** Subset of LibraryDoor fields needed for 3D rendering. */
export interface DoorData {
  Name: string;
  Type: number;
  DefaultW: number;       // mm
  DefaultH: number;       // mm
  HasTopRail: boolean;
  HasBottomRail: boolean;
  HasLeftStile: boolean;
  HasRightStile: boolean;
  TopRailW: number;       // mm
  BottomRailW: number;    // mm
  LeftRightStileW: number; // mm
  CenterStileW: number;
  CenterRailW: number;
  PanelRecess: number;    // mm — how far panel sits behind frame face
  MainSection: MainSectionData;
  RoutedLockedShape?: {
    Operations?: {
      OperationPocket: OperationData[];
      OperationHole?: HoleData[];
    };
  };
}

export interface MainSectionData {
  IsSplitSection: boolean;
  X: number;
  Y: number;
  DX: number;             // panel width (mm)
  DY: number;             // panel height (mm)
  SplitType?: number;
  Dividers?: {
    Divider: DividerData[];
  };
  SubPanels?: {
    SubPanel: SubPanelData[];
  };
}

export interface DividerData {
  DB: number;             // divider bar width (mm)
  DBStart: number;        // start position from frame top edge (mm)
}

export interface SubPanelData {
  DA: number;             // panel height (mm)
  Panel: {
    X: number;
    Y: number;
    DX: number;
    DY: number;
  };
}

export interface ToolPathNodeData {
  X: number;
  Y: number;
  DepthOR: number;
  PtType: number;
  Data: number;
}

export interface OperationData {
  ToolGroupID: number;
  Depth: number;
  FlipSideOp: boolean;
  ID: number;
  ClosedShape?: boolean;
  InsideOut?: boolean;
  CCW?: boolean;
  OperationToolPathNode?: ToolPathNodeData[];
}

/** Tracks which operations are visible in the 3D scene. Keyed by operation ID. */
export type OperationVisibility = Record<number, boolean>;

/**
 * Tracks which individual tools within operations are visible.
 * Key format: "${operationId}-${toolIndex}" (0-based index in the tool list).
 * Missing keys are treated as visible (default ON).
 */
export type ToolVisibility = Record<string, boolean>;

export interface DoorGraphData {
  doorName: string;
  doorType: number;
  operationCount: number;
  operations: {
    operationId: number;
    toolGroupId: number;
    toolGroupName: string;
    alignment: number;
    depth: number;
    flipSideOp: boolean;
    toolCount: number;
    tools: {
      toolId: number;
      toolName: string;
      isCNCDoor: boolean;
      toolDiameter: number;
      sharpCornerAngle: number;
      entryDepth: number;
      entryOffset: number;
      flipSide: boolean;
    }[];
  }[];
}

/** A single shape point from a tool profile. */
export interface ProfilePointData {
  x_mm: number;
  y_mm: number;
  x_in: number;
  y_in: number;
  ptType: number;
  data: number;
}

/** A tool profile from profiles.json. */
export interface ToolProfileData {
  toolId: number;
  toolName: string;
  diameter_mm: number;
  diameter_in: number;
  points: ProfilePointData[];
}

/** Material thickness — standard 3/4" stock. */
export const MATERIAL_THICKNESS = 19.05; // mm

/** Panel type for Generic Door front/back panel configuration. */
export type PanelType = 'pocket' | 'raised' | 'glass';

/** Glass pane thickness: 1/8" = 3.175 mm. */
export const GLASS_THICKNESS = 3.175;

/** Unit system for display. */
export type UnitSystem = 'mm' | 'in';

/** Format a mm value in the active unit system. */
export function formatUnit(mm: number, units: UnitSystem, decimals?: number): string {
  if (units === 'in') return `${(mm / 25.4).toFixed(decimals ?? 3)}"`;
  return `${mm.toFixed(decimals ?? 2)} mm`;
}

// ---------------------------------------------------------------------------
// Raw tool library types (loaded from toolGroups.json / tools.json)
// ---------------------------------------------------------------------------

export interface RawToolEntry {
  ToolID: number;
  Depth: number;       // mm
  Offset: number;      // mm (can be negative)
  ThruCut: boolean;
  SharpCorners: boolean;
  NoRamp: boolean;
  FlipSide: boolean;
}

export interface RawToolGroup {
  Name: string;
  Type: number;          // 0 = panel op, 1 = edge op
  ToolGroupID: number;
  Alignment: number;
  DefaultMaterialThickness: number;
  PartSpacing: number;
  ToolEntry: RawToolEntry[];
}

export interface RawTool {
  Name: string;
  ToolID: number;
  Dia: number;            // diameter mm
  SharpCornerAngle: number;
  AppCNCDoor: boolean;
}

// ---------------------------------------------------------------------------
// Hardware types (hinges, handles, bore holes)
// ---------------------------------------------------------------------------

/** Part type for generic door configuration. */
export type DoorPartType = 'door' | 'drawer' | 'reduced-rail' | 'end-panel' | 'slab';

/** How back operations apply to split panels. */
export type BackPocketMode = 'all' | 'selected' | 'full';

export type HingeSide = 'left' | 'right' | 'top' | 'bottom';
export type HandlePlacement = 'center' | 'top-rail' | 'two-equidistant';
export type DoorHandlePlacement = 'top' | 'center-top' | 'middle' | 'bottom' | 'custom';
export type HandleElevationRef = 'from-top' | 'from-bottom';

export type RenderMode = 'solid' | 'wireframe';

/** Texture manifest returned by /api/textures. */
export interface TextureManifest {
  painted: Record<string, string[]>;  // brand → filenames (may be empty)
  primed: string[];
  raw: string[];
  sanded: string[];
  categories: {
    painted: boolean;
    primed: boolean;
    raw: boolean;
    sanded: boolean;
  };
}

/** A single bore hole operation (hinge cup, mounting hole, or handle hole). */
export interface HoleData {
  X: number;           // Mozaik X (height axis), mm
  Y: number;           // Mozaik Y (width axis), mm
  Diameter: number;    // mm
  Depth: number;       // mm
  FlipSideOp: boolean; // true = drilled from back face
  holeType: 'hinge-cup' | 'hinge-mount' | 'handle';
  depthEq?: string;    // "PartTH" for cut-through handles, empty otherwise
}

export interface HingeConfig {
  enabled: boolean;
  side: HingeSide;
  count: number;           // 2–6
  equidistant: boolean;    // true = auto-space, false = manual positions
  positions: number[];     // manual hinge positions (mm from bottom/left edge)
  edgeDistance: number;     // mm from door top/bottom to first/last hinge center
  cupDia: number;          // default 35mm
  cupDepth: number;        // default 15mm
  cupBoringDist: number;   // door edge to cup hole edge, default 5mm
  mountDia: number;        // default 8mm
  mountDepth: number;      // default 13mm
  mountSeparation: number; // vertical distance between mounting holes, default 45mm
  mountInset: number;      // mounting holes inward from cup center, default 9.5mm
  mountOnFront: boolean;   // false = back (default)
}

export interface HandleConfig {
  enabled: boolean;
  holeDia: number;         // default 5mm
  holeDepth: number;       // default 19mm
  cutThrough: boolean;     // when true, depth = material thickness (exports Depth_Eq="PartTH")
  holeSeparation: number;  // default 101.6mm (4"); 0 = knob (single hole)
  insetFromEdge: number;   // default 28.575mm
  elevation: number;       // mm from reference edge
  elevationRef: HandleElevationRef;
  placement: HandlePlacement; // for drawers/reduced-rail/slab
  doorPlacement: DoorHandlePlacement; // preset position for door-type handles
  twoHandleEdgeDist: number; // mm from door left/right to handle center (two-equidistant)
  onFront: boolean;        // true = front (default)
}

export const DEFAULT_HINGE_CONFIG: HingeConfig = {
  enabled: false,
  side: 'left',
  count: 2,
  equidistant: true,
  positions: [],
  edgeDistance: 85.6,      // ~3.37"
  cupDia: 35,
  cupDepth: 15,
  cupBoringDist: 4,
  mountDia: 8,
  mountDepth: 13,
  mountSeparation: 45,
  mountInset: 9.5,
  mountOnFront: false,
};

export const DEFAULT_HANDLE_CONFIG: HandleConfig = {
  enabled: false,
  holeDia: 5,
  holeDepth: 19,
  cutThrough: true,
  holeSeparation: 101.6,   // 4"
  insetFromEdge: 28.575,
  elevation: 114.3,        // ~4.5" from top
  elevationRef: 'from-top',
  placement: 'center',
  doorPlacement: 'top',
  twoHandleEdgeDist: 127,  // 5" from each edge
  onFront: true,
};

// ---------------------------------------------------------------------------
// Layout slot system — 5-panel swappable layout (default) / 4-panel compact
// ---------------------------------------------------------------------------

export type LayoutPreset = 'default' | 'compact';

export type PanelContentId = 'toolbar' | 'crossSection' | 'canvas3d' | 'elevation' | 'orderList';
export type SlotPosition = 'left-top' | 'left-mid' | 'left-bot' | 'right-top' | 'right-bot';
export type LayoutMapping = Record<SlotPosition, PanelContentId>;

export const DEFAULT_LAYOUT: LayoutMapping = {
  'left-top': 'toolbar',
  'left-mid': 'crossSection',
  'left-bot': 'canvas3d',
  'right-top': 'elevation',
  'right-bot': 'orderList',
};

// Compact layout: 2 tall left panels + top-right split (3D | elevation) + bottom-right order list
export type CompactSlotPosition = 'left-top' | 'left-bot' | 'right-top-left' | 'right-top-right' | 'right-bot';
export type CompactLayoutMapping = Record<CompactSlotPosition, PanelContentId>;

export const COMPACT_LAYOUT: CompactLayoutMapping = {
  'left-top': 'toolbar',
  'left-bot': 'crossSection',
  'right-top-left': 'canvas3d',
  'right-top-right': 'elevation',
  'right-bot': 'orderList',
};

export const PANEL_DISPLAY_NAMES: Record<PanelContentId, string> = {
  toolbar: 'Toolbar',
  crossSection: 'Cross Section',
  canvas3d: '3D Canvas',
  elevation: 'Elevation',
  orderList: 'Order List',
};

export const ALL_SLOTS: SlotPosition[] = ['left-top', 'left-mid', 'left-bot', 'right-top', 'right-bot'];
export const COMPACT_SLOTS: CompactSlotPosition[] = ['left-top', 'left-bot', 'right-top-left', 'right-top-right', 'right-bot'];
