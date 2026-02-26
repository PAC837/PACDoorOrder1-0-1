import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDoors } from './parsers/parseDoors.js';
import { parseToolGroups } from './parsers/parseToolGroups.js';
import { parseToolLib } from './parsers/parseToolLib.js';
import { buildGraph } from './normalizers/buildGraph.js';
import { extractProfiles } from './normalizers/extractProfiles.js';
import { diffDoors } from './normalizers/diffDoors.js';
import { exportToOptimizerXml } from './exporters/exportOptimizer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

const DATA_DIR = resolve(projectRoot, 'Control Doors S008');
const DOORS_FILE = resolve(DATA_DIR, 'Door Visualizer 1.0', 'Doors.dat');
const TOOLGROUPS_FILE = resolve(DATA_DIR, 'ToolGroups.dat');
const TOOLLIB_FILE = resolve(DATA_DIR, 'ToolLib.dat');
const OUTPUT_DIR = resolve(projectRoot, 'output');

function main() {
  console.log('=== Mozaik CNC Door Compiler ===\n');

  // --- Step 1: Parse ---
  console.log('Parsing XML data files...');

  const doorsRaw = readFileSync(DOORS_FILE, 'utf-8');
  const toolGroupsRaw = readFileSync(TOOLGROUPS_FILE, 'utf-8');
  const toolLibRaw = readFileSync(TOOLLIB_FILE, 'utf-8');

  const doors = parseDoors(doorsRaw);
  const toolGroups = parseToolGroups(toolGroupsRaw);
  const tools = parseToolLib(toolLibRaw);

  console.log(`  Doors parsed:       ${doors.length}`);
  console.log(`  Tool groups parsed: ${toolGroups.length}`);
  console.log(`  Tools parsed:       ${tools.length}`);

  // --- Step 2: Build Graph ---
  console.log('\nBuilding relational graph...');

  const doorGraphs = buildGraph(doors, tools, toolGroups);

  const cncDoors = doorGraphs.filter(
    (dg) => dg.operations.length > 0
  );
  console.log(`  Resolved door graphs: ${doorGraphs.length}`);
  console.log(`  CNC doors (with operations): ${cncDoors.length}`);

  // --- Step 3: Extract Profiles ---
  console.log('\nExtracting CNC tool profiles...');

  const profiles = extractProfiles(tools);
  console.log(`  CNC profiles extracted: ${profiles.length}`);

  for (const p of profiles) {
    console.log(`    - ${p.toolName} (ID: ${p.toolId}): ${p.points.length} shape points`);
  }

  // --- Step 4: Diff Door Variants ---
  console.log('\nDiffing door variants...');

  const baseDoor = doors.find((d) => d.Name === '_S008 Inside Bead125 Door');
  const backPocketDoor = doors.find((d) => d.Name === '_S008BP Inside Bead125 Door BACK POCKET');
  const midRailDoor = doors.find((d) => d.Name === '_S008 Inside Bead125 Door MID RAIL');

  const diffs = [];

  if (baseDoor && backPocketDoor) {
    const diff = diffDoors(baseDoor, backPocketDoor);
    diffs.push(diff);
    console.log(`\n  [DIFF] "${diff.doorA}" vs "${diff.doorB}"`);
    console.log(`    Attribute diffs:  ${diff.attributeDiffs.length}`);
    console.log(`    Operation diffs:  ${diff.operationDiffs.length}`);
    console.log(`    Section diffs:    ${diff.sectionDiffs.length}`);
    for (const od of diff.operationDiffs) {
      console.log(`      ${od.type.toUpperCase()} op ${od.operationId}: ${od.details}`);
    }
  }

  if (baseDoor && midRailDoor) {
    const diff = diffDoors(baseDoor, midRailDoor);
    diffs.push(diff);
    console.log(`\n  [DIFF] "${diff.doorA}" vs "${diff.doorB}"`);
    console.log(`    Attribute diffs:  ${diff.attributeDiffs.length}`);
    console.log(`    Operation diffs:  ${diff.operationDiffs.length}`);
    console.log(`    Section diffs:    ${diff.sectionDiffs.length}`);
    for (const ad of diff.attributeDiffs) {
      console.log(`      ${ad.path}: ${ad.valueA} -> ${ad.valueB}`);
    }
    for (const sd of diff.sectionDiffs) {
      console.log(`      ${sd.type.toUpperCase()} ${sd.path}: ${sd.details}`);
    }
    for (const od of diff.operationDiffs) {
      console.log(`      ${od.type.toUpperCase()} op ${od.operationId}: ${od.details}`);
    }
  }

  if (backPocketDoor && midRailDoor) {
    const diff = diffDoors(backPocketDoor, midRailDoor);
    diffs.push(diff);
    console.log(`\n  [DIFF] "${diff.doorA}" vs "${diff.doorB}"`);
    console.log(`    Attribute diffs:  ${diff.attributeDiffs.length}`);
    console.log(`    Operation diffs:  ${diff.operationDiffs.length}`);
    console.log(`    Section diffs:    ${diff.sectionDiffs.length}`);
  }

  // --- Step 5: Write JSON Output ---
  console.log('\nWriting output JSON files...');

  mkdirSync(OUTPUT_DIR, { recursive: true });

  writeFileSync(
    resolve(OUTPUT_DIR, 'doors.json'),
    JSON.stringify(doors, null, 2)
  );
  writeFileSync(
    resolve(OUTPUT_DIR, 'toolGroups.json'),
    JSON.stringify(toolGroups, null, 2)
  );
  writeFileSync(
    resolve(OUTPUT_DIR, 'tools.json'),
    JSON.stringify(tools, null, 2)
  );
  writeFileSync(
    resolve(OUTPUT_DIR, 'profiles.json'),
    JSON.stringify(profiles, null, 2)
  );

  // Serialize door graphs — convert Maps to plain objects for JSON
  const serializableGraphs = doorGraphs.map((dg) => ({
    doorName: dg.door.Name,
    doorType: dg.door.Type,
    operationCount: dg.operations.length,
    operations: dg.operations.map((op) => ({
      operationId: op.operation.ID,
      toolGroupId: op.operation.ToolGroupID,
      toolGroupName: op.toolGroup.group.Name,
      depth: op.operation.Depth,
      flipSideOp: op.operation.FlipSideOp,
      toolCount: op.toolGroup.tools.length,
      tools: op.toolGroup.tools.map((t) => ({
        toolId: t.tool.ToolID,
        toolName: t.tool.Name,
        isCNCDoor: t.tool.AppCNCDoor,
        toolDiameter: t.tool.Dia,
        sharpCornerAngle: t.tool.SharpCornerAngle,
        entryDepth: t.entry.Depth,
        entryOffset: t.entry.Offset,
      })),
    })),
  }));

  writeFileSync(
    resolve(OUTPUT_DIR, 'doorGraphs.json'),
    JSON.stringify(serializableGraphs, null, 2)
  );
  writeFileSync(
    resolve(OUTPUT_DIR, 'diffs.json'),
    JSON.stringify(diffs, null, 2)
  );

  // --- Step 6: Export Mozaik Optimizer XML ---
  console.log('\nExporting Mozaik optimizer XML...');

  // Export CNC doors (Type=3 with RoutedLockedShape) to optimizer format
  const cncDoorObjects = doors.filter(
    (d) => d.Type === 3 && d.RoutedLockedShape
  );
  const optimizerXml = exportToOptimizerXml(cncDoorObjects);
  writeFileSync(
    resolve(OUTPUT_DIR, 'optimizer-export.xml'),
    optimizerXml
  );
  console.log(`  Exported ${cncDoorObjects.length} CNC doors to optimizer-export.xml`);

  console.log(`\n  Written to: ${OUTPUT_DIR}/`);
  console.log('    - doors.json');
  console.log('    - toolGroups.json');
  console.log('    - tools.json');
  console.log('    - profiles.json');
  console.log('    - doorGraphs.json');
  console.log('    - diffs.json');
  console.log('    - optimizer-export.xml');

  console.log('\n=== Done ===');
}

main();
