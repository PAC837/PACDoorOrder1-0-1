import type { Tool } from '../schemas/ToolSchema.js';
import type { ToolProfile, ToolProfilePoint } from '../schemas/ProfileSchema.js';
import { MM_PER_INCH } from '../schemas/shared.js';

/**
 * Extract CNC door tool profiles from tools where AppCNCDoor=true.
 * Only tools with a ToolShape containing ShapePoints are included.
 */
export function extractProfiles(tools: Tool[]): ToolProfile[] {
  return tools
    .filter((t) => t.AppCNCDoor && t.ToolShape && t.ToolShape.ShapePoint.length > 0)
    .map((t) => {
      const points: ToolProfilePoint[] = t.ToolShape!.ShapePoint.map((sp) => ({
        x_mm: sp.X,
        y_mm: sp.Y,
        x_in: sp.X / MM_PER_INCH,
        y_in: sp.Y / MM_PER_INCH,
        ptType: sp.PtType,
        data: sp.Data,
      }));

      return {
        toolId: t.ToolID,
        toolName: t.Name,
        diameter_mm: t.Dia,
        diameter_in: t.Dia / MM_PER_INCH,
        points,
      };
    });
}
