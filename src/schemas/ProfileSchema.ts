/** A single point in a tool's cutting profile, stored in both mm and inches. */
export interface ToolProfilePoint {
  x_mm: number;
  y_mm: number;
  x_in: number;
  y_in: number;
  ptType: number;     // 0=line, 1=arc tangent, 2=bezier
  data: number;       // arc radius when ptType=1
}

/** Extracted CNC door tool profile with shape geometry. */
export interface ToolProfile {
  toolId: number;
  toolName: string;
  diameter_mm: number;
  diameter_in: number;
  points: ToolProfilePoint[];
}

/** Result of comparing two LibraryDoor objects. */
export interface DoorDiffResult {
  doorA: string;
  doorB: string;
  attributeDiffs: AttributeDiff[];
  operationDiffs: OperationDiff[];
  sectionDiffs: SectionDiff[];
}

/** A scalar attribute difference between two doors. */
export interface AttributeDiff {
  path: string;
  valueA: unknown;
  valueB: unknown;
}

/** An operation-level difference between two doors. */
export interface OperationDiff {
  type: 'added' | 'removed' | 'changed';
  operationId: number;
  details: string;
}

/** A structural section difference between two doors. */
export interface SectionDiff {
  type: 'added' | 'removed' | 'changed';
  path: string;
  details: string;
}
