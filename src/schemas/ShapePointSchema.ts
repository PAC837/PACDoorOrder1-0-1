import { z } from 'zod';
import { xmlNum, xmlBool, xmlStr } from './shared.js';

export const ShapePointSchema = z.object({
  ID:         xmlNum,
  X:          xmlNum,
  Y:          xmlNum,
  PtType:     xmlNum,     // 0=line, 1=arc tangent, 2=bezier
  Data:       xmlNum,     // arc radius when PtType=1, else 0
  EdgeType:   xmlNum,
  Anchor:     xmlStr,     // "", "BR", "TR", "TL", "BL", "Top", "Bottom"
  EBand:      xmlNum,
  X_Eq:       xmlStr,     // parametric expression or ""
  Y_Eq:       xmlStr,     // parametric expression or ""
  Data_Eq:    xmlStr,     // parametric expression or ""
  LAdj:       xmlNum,
  RAdj:       xmlNum,
  TAdj:       xmlNum,
  BAdj:       xmlNum,
  Scribe:     xmlNum,
  Source:     xmlNum,
  BoreHoles:  xmlNum,
  EBandLock:  xmlBool,
  SideName:   xmlStr,     // "Right", "Top", "Left", "Bottom", or ""
});

export type ShapePoint = z.infer<typeof ShapePointSchema>;
