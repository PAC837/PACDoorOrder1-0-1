import { z } from 'zod';
import { xmlNum, xmlBool, xmlStr } from './shared.js';
import { ShapePointSchema } from './ShapePointSchema.js';

export const ToolShapeSchema = z.object({
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

export const ToolSchema = z.object({
  Name:               xmlStr,
  Type:               xmlStr,     // "Compression", etc.
  Image:              xmlStr,
  Dia:                xmlNum,     // diameter in mm
  StepOver:           xmlNum,
  PassD:              xmlNum,
  PlungeD:            xmlNum,
  AppRoughing:        xmlBool,
  AppProfile:         xmlBool,
  AppDrill:           xmlBool,
  AppDado:            xmlBool,
  AppPocket:          xmlBool,
  AppDoveT:           xmlBool,
  Speed1:             xmlNum,
  Speed2:             xmlNum,
  Feed1:              xmlNum,
  Feed2:              xmlNum,
  Plunge1:            xmlNum,
  Plunge2:            xmlNum,
  Oset:               xmlNum,
  ThruAdd:            xmlNum,
  BlindBoreAdd:       xmlNum,
  CCW:                xmlBool,
  ToolID:             xmlNum,
  Priority:           xmlNum,
  ToolMapNo:          xmlStr,
  AppSharpCorners:    xmlBool,
  AppCNCDoor:         xmlBool,
  SharpCornerAngle:   xmlNum,
  PocketRampDist:     xmlNum,
  ToolShape:          ToolShapeSchema.optional(),
});

export type Tool = z.infer<typeof ToolSchema>;
export type ToolShape = z.infer<typeof ToolShapeSchema>;
