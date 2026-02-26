import { z } from 'zod';
import { xmlNum, xmlBool, xmlStr, xmlId } from './shared.js';
import { ShapePointSchema } from './ShapePointSchema.js';

// --- Adjustment Schemas ---

export const ShapeAdjustmentSchema = z.object({
  ShapeAdjTop:    xmlNum,
  ShapeAdjLeft:   xmlNum,
  ShapeAdjRight:  xmlNum,
  ShapeAdjBottom: xmlNum,
  InsetORTop:     xmlNum.optional(),
  InsetORLeft:    xmlNum.optional(),
  InsetORRight:   xmlNum.optional(),
  InsetORBottom:  xmlNum.optional(),
});

export const RailStileAdjustmentSchema = z.object({
  ShapeAdjTop:    xmlNum,
  ShapeAdjLeft:   xmlNum,
  ShapeAdjRight:  xmlNum,
  ShapeAdjBottom: xmlNum,
});

// --- Panel Geometry (for split section sub-panels) ---

export const PanelShapeSchema = z.object({
  Version:            xmlNum,
  Name:               xmlStr,
  Type:               xmlNum,
  RadiusX:            xmlNum,
  RadiusY:            xmlNum,
  Source:             xmlNum,
  Data1:              xmlNum,
  Data2:              xmlNum,
  RotAng:             xmlNum,
  DoNotTranslateTo00: xmlBool,
  ShapePoint:         z.array(ShapePointSchema).default([]),
});

export const PanelSchema = z.object({
  IsSplitSection:   xmlBool,
  Type:             xmlNum,
  Filename:         xmlStr,
  SlatWidth:        xmlNum,
  X:                xmlNum,
  Y:                xmlNum,
  DX:               xmlNum,
  DY:               xmlNum,
  AutoAdjustShape:  xmlBool,
  ShapeAdjustment:  ShapeAdjustmentSchema.optional(),
  PanelShape:       PanelShapeSchema.optional(),
});

// --- Dividers ---

export const DividerSchema = z.object({
  DB:               xmlNum,     // divider bar width (mm)
  DBStart:          xmlNum,     // start position (mm)
  AutoAdjustShape:  xmlBool,
  ShapeAdjustment:  ShapeAdjustmentSchema.optional(),
});

// --- SubPanels ---

export const SubPanelSchema = z.object({
  Locked:                 xmlBool,
  UnlockedDAPercentage:   xmlNum,
  DA:                     xmlNum,     // dimension (mm)
  Panel:                  PanelSchema,
});

// --- Operation Components ---

export const OperationToolPathNodeSchema = z.object({
  X:          xmlNum,
  Y:          xmlNum,
  DepthOR:    xmlNum,     // -9999 = use operation depth
  PtType:     xmlNum,
  Data:       xmlNum,
  X_Eq:       xmlStr,     // parametric expression
  Y_Eq:       xmlStr,     // parametric expression
  Data_Eq:    xmlStr,
  Anchor:     xmlStr,
});

export const OpIdTagReferenceSchema = z.object({
  Key:    xmlStr,
  Value:  xmlStr,
});

export const OpIdTagSchema = z.object({
  TypeCode:         xmlNum,     // 29 for panel ops, 0 for back pocket
  LegacyNumber:     xmlNum,     // 54000, 54001, 54002
  OpIdTagReference: OpIdTagReferenceSchema.optional(),
});

export const OperationPocketSchema = z.object({
  CCW:                    xmlBool,
  InsideOut:              xmlBool,
  PocketingToolID:        xmlId,
  ToolID:                 xmlId,      // -1 = resolved via ToolGroup
  ToolGroupID:            xmlNum,
  DecorativeProfileID:    xmlId,
  ClosedShape:            xmlBool,
  ToolPathWidth:          xmlNum,
  NoRamp:                 xmlBool,
  NextToolPathIdTag:      xmlId,
  ToolPathIdTag:          xmlId,
  ID:                     xmlNum,     // sequential operation ID
  X:                      xmlNum,
  Y:                      xmlNum,
  Depth:                  xmlNum,     // mm
  Hide:                   xmlBool,
  X_Eq:                   xmlStr,
  Y_Eq:                   xmlStr,
  Depth_Eq:               xmlStr,     // "6.35", ".125*TOMM"
  Hide_Eq:                xmlStr,
  IsUserOp:               xmlBool,
  Noneditable:            xmlBool,
  Anchor:                 xmlStr,
  FlipSideOp:             xmlBool,    // true = back-side operation
  OpIdTag:                OpIdTagSchema,
  OperationToolPathNode:  z.array(OperationToolPathNodeSchema).default([]),
});

// --- Operations Container ---

export const OperationsSchema = z.object({
  Version:          xmlNum,
  OperationPocket:  z.array(OperationPocketSchema).default([]),
});

// --- Routed Locked Shape (door outline + CNC operations) ---

export const RoutedLockedShapeSchema = z.object({
  Version:            xmlNum,
  Name:               xmlStr,
  Type:               xmlNum,
  RadiusX:            xmlNum,
  RadiusY:            xmlNum,
  Source:             xmlNum,
  Data1:              xmlNum,
  Data2:              xmlNum,
  RotAng:             xmlNum,
  DoNotTranslateTo00: xmlBool,
  ShapePoint:         z.array(ShapePointSchema).default([]),
  Operations:         OperationsSchema.optional(),
});

// --- Main Section ---
// Handles both simple panels (IsSplitSection=False) and split sections with Dividers/SubPanels

/** Normalize single element or array into array */
const ensureArray = <T>(schema: z.ZodType<T>) =>
  z.union([schema, z.array(schema)]).transform(
    (v): T[] => (Array.isArray(v) ? v : [v])
  );

export const MainSectionSchema = z.object({
  IsSplitSection:   xmlBool,
  Type:             xmlNum.optional(),
  Filename:         xmlStr.optional(),
  SlatWidth:        xmlNum.optional(),
  X:                xmlNum,
  Y:                xmlNum,
  DX:               xmlNum,
  DY:               xmlNum,
  AutoAdjustShape:  xmlBool.optional(),
  SplitType:        xmlNum.optional(),     // 1 = horizontal; only when split
  ShapeAdjustment:  ShapeAdjustmentSchema.optional(),
  Dividers:         z.object({
    Divider: ensureArray(DividerSchema),
  }).optional(),
  SubPanels:        z.object({
    SubPanel: ensureArray(SubPanelSchema),
  }).optional(),
});

// --- LibraryDoor ---

export const LibraryDoorSchema = z.object({
  // Identity
  Name:                         xmlStr,
  Type:                         xmlNum,     // 2=slab, 3=routed CNC
  Comment:                      xmlStr,
  IsDrawerFront:                xmlBool,

  // Default dimensions (mm)
  DefaultW:                     xmlNum,
  DefaultH:                     xmlNum,

  // Dimension constraints
  MinW:                         xmlNum,
  MinWReplacement:              xmlStr,
  MaxW:                         xmlNum,
  MaxWReplacement:              xmlStr,
  MinH:                         xmlNum,
  MinHReplacement:              xmlStr,
  MaxH:                         xmlNum,
  MaxHReplacement:              xmlStr,

  // Frame members
  HasTopRail:                   xmlBool,
  HasBottomRail:                xmlBool,
  HasLeftStile:                 xmlBool,
  HasRightStile:                xmlBool,
  TopRailW:                     xmlNum,
  BottomRailW:                  xmlNum,
  LeftRightStileW:              xmlNum,
  CenterStileW:                 xmlNum,
  CenterRailW:                  xmlNum,
  StileRailInset:               xmlNum,

  // Panel geometry
  PanelInsetTop:                xmlNum,
  PanelInsetBottom:             xmlNum,
  PanelInsetSide:               xmlNum,
  PanelRecess:                  xmlNum,
  DividerThickness:             xmlNum,

  // Flags
  IsBuyoutDoor:                 xmlBool,
  IsOversize:                   xmlBool,
  OversizeAdj:                  xmlNum,
  BoreForHinge:                 xmlBool,
  BoreForPulls:                 xmlBool,
  BoreForLocks:                 xmlBool,
  ApplyBanding:                 xmlBool,
  IsHorizontalGrain:            xmlBool,
  DisplaySKPFile:               xmlStr,
  UsesDisplaySKPFile:           xmlBool,
  IsAppliedDividers:            xmlBool,
  IsBeaded:                     xmlBool,
  IsLongRails:                  xmlBool,
  MitreFrameProfileID:          xmlId,
  AppliedMoldingProfileID:      xmlNum.optional(),

  // Pricing
  IsPricedPerDoor:              xmlBool,
  PricePerDoor:                 xmlNum,
  MarkupPerDoor:                xmlNum,
  IsPricedPerSqFt:              xmlBool,
  PricePerSqFt:                 xmlNum,
  MinSqFtToPrice:               xmlNum,
  PricePerSqM:                  xmlNum,
  MinSqMToPrice:                xmlNum,
  MarkupPerSqFt:                xmlNum,
  AddMaterialCostToDoor:        xmlBool,
  AddProfileCostToDoor:         xmlBool,

  // Labor
  UsesMinutesToCutParts:        xmlBool,
  MinutesToCutParts:            xmlNum,
  UsesMinutesToAssemble:        xmlBool,
  MinutesToAssemble:            xmlNum,

  // Routed (CNC) configuration
  RoutedLockedCutoutToolpathIDs: xmlStr.optional(),
  RoutedHasTopRail:             xmlBool,
  RoutedHasBottomRail:          xmlBool,
  RoutedTopRailW:               xmlNum,
  RoutedBottomRailW:            xmlNum,
  RoutedSpecialMullions:        xmlNum,
  RoutedSpecialMullionWidth:    xmlNum,

  // Auto-adjust flags
  TopRailAutoAdjustShape:       xmlBool,
  BottomRailAutoAdjustShape:    xmlBool,
  LeftStileAutoAdjustShape:     xmlBool,
  RightStileAutoAdjustShape:    xmlBool,

  // Pricing per sqm (may only appear sometimes)
  IsPricedPerSqM:               xmlBool.optional(),

  // Child elements
  MainSection:                  MainSectionSchema,
  TopRailAdjustment:            RailStileAdjustmentSchema,
  BottomRailAdjustment:         RailStileAdjustmentSchema,
  LeftStileAdjustment:          RailStileAdjustmentSchema,
  RightStileAdjustment:         RailStileAdjustmentSchema,
  RoutedLockedShape:            RoutedLockedShapeSchema.optional(),
  RoutedTopRailAdjustment:      RailStileAdjustmentSchema.optional(),
  RoutedBottomRailAdjustment:   RailStileAdjustmentSchema.optional(),
});

export type LibraryDoor = z.infer<typeof LibraryDoorSchema>;
export type MainSection = z.infer<typeof MainSectionSchema>;
export type OperationPocket = z.infer<typeof OperationPocketSchema>;
export type OperationToolPathNode = z.infer<typeof OperationToolPathNodeSchema>;
export type ShapeAdjustment = z.infer<typeof ShapeAdjustmentSchema>;
