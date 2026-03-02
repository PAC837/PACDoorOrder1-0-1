// ---------------------------------------------------------------------------
// Parameter registry — single source of truth for the Configure matrix rows.
// Adding a new parameter = adding one entry here + its default in server/db.ts.
// ---------------------------------------------------------------------------

export type ParamType = 'checkbox-list' | 'fixed-checkbox-list' | 'group-depth-list' | 'number' | 'auto-checkbox' | 'boolean-radio' | 'texture-checkbox-list';
export type ParamSource = 'panelGroups' | 'edgeGroups';

export interface ParamDefinition {
  key: string;
  label: string;
  type: ParamType;
  source?: ParamSource;           // for checkbox-list: where items come from
  fixedOptions?: { value: string; label: string }[];  // for fixed-checkbox-list
  derivedFrom?: string[];         // for auto-checkbox: which params drive the range
  unit?: string;                  // display hint (e.g. 'mm')
}

export const PARAM_DEFINITIONS: ParamDefinition[] = [
  { key: 'isDefault',        label: 'Default',           type: 'boolean-radio' },
  { key: 'doorStyles',       label: 'Door Styles',       type: 'group-depth-list', source: 'panelGroups' },
  { key: 'stileMin',         label: 'Stile Min',         type: 'number', unit: 'mm' },
  { key: 'stileMax',         label: 'Stile Max',         type: 'number', unit: 'mm' },
  { key: 'stileCustomMin',   label: 'Stile Hard Min',    type: 'number', unit: 'mm' },
  { key: 'railMin',          label: 'Rail Min',           type: 'number', unit: 'mm' },
  { key: 'railMax',          label: 'Rail Max',           type: 'number', unit: 'mm' },
  { key: 'railCustomMin',    label: 'Rail Hard Min',      type: 'number', unit: 'mm' },
  { key: 'midStileDefaultW', label: 'Mid Stile Default', type: 'number', unit: 'mm' },
  { key: 'midRailDefaultW',  label: 'Mid Rail Default',  type: 'number', unit: 'mm' },
  { key: 'stileRailPresets', label: 'Stile/Rail Presets', type: 'auto-checkbox', derivedFrom: ['stileMin', 'stileMax'] },
  { key: 'hasEdges',         label: 'Edge Profiles',      type: 'checkbox-list', source: 'edgeGroups' },
  { key: 'glassToolGroup',   label: 'Glass Tool Group',   type: 'checkbox-list', source: 'panelGroups' },
  { key: 'panelTypes',       label: 'Panel Types',        type: 'fixed-checkbox-list', fixedOptions: [
    { value: 'pocket', label: 'Flat Panel' },
    { value: 'raised', label: 'Raised Panel' },
    { value: 'glass', label: 'Glass' },
  ]},
  { key: 'backOperations',   label: 'Back Operations',    type: 'fixed-checkbox-list', fixedOptions: [
    { value: 'none', label: 'None' },
    { value: 'back-route', label: 'Route' },
    { value: 'back-pocket', label: 'Pocket' },
    { value: 'back-bridge', label: 'Bridge' },
    { value: 'custom', label: 'Custom' },
  ]},
  { key: 'doorTypes',         label: 'Door Types',        type: 'fixed-checkbox-list', fixedOptions: [
    { value: 'door', label: 'Door' },
    { value: 'drawer', label: 'Drawer' },
    { value: 'reduced-rail', label: 'Reduced' },
    { value: 'slab', label: 'Slab' },
    { value: 'end-panel', label: 'End Panel' },
  ]},
  { key: 'backRouteGroups',  label: 'Back Route Groups',  type: 'group-depth-list', source: 'panelGroups' },
  { key: 'backPocketGroups', label: 'Back Pocket Groups', type: 'group-depth-list', source: 'panelGroups' },
  { key: 'backCustomGroups', label: 'Back Custom Groups', type: 'group-depth-list', source: 'panelGroups' },
  { key: 'hinge3Trigger',    label: '3 Hinge Height',      type: 'number', unit: 'mm' },
  { key: 'hinge4Trigger',    label: '4 Hinge Height',      type: 'number', unit: 'mm' },
  { key: 'hinge5Trigger',    label: '5 Hinge Height',      type: 'number', unit: 'mm' },
  { key: 'hinge6Trigger',    label: '6 Hinge Height',      type: 'number', unit: 'mm' },
  { key: 'hingeEdgeDistance', label: 'Hinge Edge Dist',     type: 'number', unit: 'mm' },
  { key: 'textures',        label: 'Textures',            type: 'texture-checkbox-list' },
];

// ---------------------------------------------------------------------------
// JSON value shapes per param_key
// ---------------------------------------------------------------------------

export interface CheckboxListValue {
  enabledGroupIds: number[];
}

export interface NumberValue {
  value: number;
}

export interface PresetCheckboxValue {
  enabledWidths: number[];
}

export interface BooleanRadioValue {
  enabled: boolean;
}

export interface FixedCheckboxListValue {
  enabledOptions: string[];
}

export interface GroupDepthListValue {
  entries: Array<{ groupId: number; depth: number }>;
}

export interface TextureCheckboxListValue {
  enabledTextures: string[];
}

// ---------------------------------------------------------------------------
// Helper: generate 1/8" increments between min and max (in mm)
// ---------------------------------------------------------------------------

const EIGHTH_INCH_MM = 3.175;

export function generateEighthInchIncrements(minMm: number, maxMm: number): number[] {
  const increments: number[] = [];
  // Round min up to nearest 1/8"
  const startEighths = Math.ceil(minMm / EIGHTH_INCH_MM);
  const endEighths = Math.floor(maxMm / EIGHTH_INCH_MM);
  for (let i = startEighths; i <= endEighths; i++) {
    increments.push(+(i * EIGHTH_INCH_MM).toFixed(4));
  }
  return increments;
}

export function formatMmAsFraction(mm: number): string {
  const inches = mm / 25.4;
  const eighths = Math.round(inches * 8);
  const whole = Math.floor(eighths / 8);
  const remainder = eighths % 8;
  if (remainder === 0) return `${whole}"`;
  // Simplify fraction
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(remainder, 8);
  const num = remainder / g;
  const den = 8 / g;
  return whole > 0 ? `${whole}-${num}/${den}"` : `${num}/${den}"`;
}
