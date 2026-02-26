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
