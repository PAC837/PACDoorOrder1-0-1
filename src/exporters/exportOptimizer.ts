import type { LibraryDoor, OperationPocket } from '../schemas/DoorSchema.js';

interface ExportOptions {
  materialName?: string;
  textureName?: string;
}

/**
 * Export an array of LibraryDoors to Mozaik optimizer XML format.
 * Matches the structure in `3-4 MDF sample 1.xml`:
 * - Prefix: `8\n` before XML declaration
 * - Root: `<Parts MaterialName="...">`
 * - Each door becomes a `<Part>` with Shape, Operations, and BandMatTmpSel
 * - Coordinates are already resolved (X_Eq/Y_Eq/Depth_Eq empty)
 */
export function exportToOptimizerXml(
  doors: LibraryDoor[],
  options: ExportOptions = {}
): string {
  const { materialName = '3/4 MDF', textureName = '' } = options;

  let xml = '8\n';
  xml += '<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n';
  xml += `<Parts MaterialName="${escapeXml(materialName)}">\n`;

  for (let i = 0; i < doors.length; i++) {
    xml += buildPart(doors[i], i + 1, textureName);
  }

  xml += '</Parts>\n';
  return xml;
}

function buildPart(door: LibraryDoor, partId: number, textureName: string): string {
  const w = door.DefaultW;
  const h = door.DefaultH;

  let xml = '';
  xml += `  <Part PartID="${partId}" PartNumbers="${partId}" Quan="1" Name="Door" `;
  xml += `Width="${w}" Length="${h}" EdgeBand="None" Color="None" `;
  xml += `AssyNo="R0N${partId}" Comment="Cabinet Door" UserAdded="False" `;
  xml += `RemakeJobName="" AllowRotation="1" TextureName="${escapeXml(textureName)}">\n`;

  // Shape — rectangular outline with 4 corner points
  xml += `    <Shape Version="2" Name="" Type="1" RadiusX="0" RadiusY="0" Source="1" `;
  xml += `Data1="0" Data2="0" RotAng="0" DoNotTranslateTo00="False">\n`;

  // Mozaik optimizer uses: X = along Length (height), Y = along Width
  // Corner order: (0,0) → (Length,0) → (Length,Width) → (0,Width)
  const sides = ['Right', 'Top', 'Left', 'Bottom'];
  const corners: [number, number][] = [
    [0, 0], [h, 0], [h, w], [0, w],
  ];
  for (let i = 0; i < 4; i++) {
    xml += `      <ShapePoint ID="${i}" X="${corners[i][0]}" Y="${corners[i][1]}" `;
    xml += `PtType="0" Data="0" EdgeType="0" Anchor="" EBand="0" `;
    xml += `X_Eq="" Y_Eq="" Data_Eq="" LAdj="0" RAdj="0" TAdj="0" BAdj="0" `;
    xml += `Scribe="0" Source="0" BoreHoles="0" EBandLock="False" SideName="${sides[i]}" />\n`;
  }

  // Operations from RoutedLockedShape
  const ops = door.RoutedLockedShape?.Operations?.OperationPocket ?? [];
  if (ops.length > 0) {
    xml += '      <Operations Version="2">\n';
    for (const op of ops) {
      xml += buildOperation(op);
    }
    xml += '      </Operations>\n';
  }

  xml += '    </Shape>\n';

  // BandMatTmpSel — static edge banding template
  xml += '    <BandMatTmpSel RootTemplateId="71" MissingTemplateName="PVC Banding">\n';
  for (let i = 1; i <= 6; i++) {
    const suffix = i === 1 ? '' : String(i);
    xml += `      <TextureIdOverrideByPartType PartType="EDGEBAND${suffix}" Id="227" ManuallyChanged="False" />\n`;
  }
  xml += '    </BandMatTmpSel>\n';

  xml += '  </Part>\n';
  return xml;
}

function buildOperation(op: OperationPocket): string {
  let xml = '';
  xml += `        <OperationPocket CCW="${boolStr(op.CCW)}" InsideOut="${boolStr(op.InsideOut)}" `;
  xml += `PocketingToolID="${op.PocketingToolID}" ToolID="${op.ToolID}" `;
  xml += `ToolGroupID="${op.ToolGroupID}" DecorativeProfileID="${op.DecorativeProfileID}" `;
  xml += `ClosedShape="${boolStr(op.ClosedShape)}" ToolPathWidth="${op.ToolPathWidth}" `;
  xml += `NoRamp="${boolStr(op.NoRamp)}" NextToolPathIdTag="${op.NextToolPathIdTag}" `;
  xml += `ToolPathIdTag="${op.ToolPathIdTag}" ID="${op.ID}" X="0" Y="0" `;
  xml += `Depth="${op.Depth}" Hide="${boolStr(op.Hide)}" `;
  xml += `X_Eq="" Y_Eq="" Depth_Eq="" Hide_Eq="" `;
  xml += `IsUserOp="${boolStr(op.IsUserOp)}" Noneditable="${boolStr(op.Noneditable)}" `;
  xml += `Anchor="" FlipSideOp="${boolStr(op.FlipSideOp)}">\n`;

  // OpIdTag
  xml += `          <OpIdTag TypeCode="${op.OpIdTag.TypeCode}" LegacyNumber="${op.OpIdTag.LegacyNumber}"`;
  if (op.OpIdTag.OpIdTagReference) {
    xml += `>\n`;
    xml += `            <OpIdTagReference Key="${escapeXml(op.OpIdTag.OpIdTagReference.Key)}" Value="${escapeXml(op.OpIdTag.OpIdTagReference.Value)}" />\n`;
    xml += `          </OpIdTag>\n`;
  } else {
    xml += ` />\n`;
  }

  // ToolPathNodes — output with resolved numeric coordinates
  for (const node of op.OperationToolPathNode) {
    xml += `          <OperationToolPathNode X="${node.X}" Y="${node.Y}" `;
    xml += `DepthOR="${node.DepthOR}" PtType="${node.PtType}" Data="${node.Data}" `;
    xml += `X_Eq="" Y_Eq="" Data_Eq="" Anchor="" />\n`;
  }

  xml += '        </OperationPocket>\n';
  return xml;
}

function boolStr(val: boolean): string {
  return val ? 'True' : 'False';
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
