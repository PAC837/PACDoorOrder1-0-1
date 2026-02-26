import { z } from 'zod';
import { xmlNum, xmlBool, xmlStr } from './shared.js';

export const ToolEntrySchema = z.object({
  ToolID:       xmlNum,
  Depth:        xmlNum,     // mm
  Offset:       xmlNum,     // mm (can be negative)
  ThruCut:      xmlBool,
  SharpCorners: xmlBool,
  NoRamp:       xmlBool,
  FlipSide:     xmlBool,
});

export const ToolGroupSchema = z.object({
  Name:                     xmlStr,
  Type:                     xmlNum,
  ToolGroupID:              xmlNum,
  Alignment:                xmlNum,
  DefaultMaterialThickness: xmlNum,     // mm
  PartSpacing:              xmlNum,
  ToolEntry:                z.array(ToolEntrySchema).default([]),
});

export type ToolGroup = z.infer<typeof ToolGroupSchema>;
export type ToolEntry = z.infer<typeof ToolEntrySchema>;
