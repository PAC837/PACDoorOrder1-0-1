import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface LoadResult {
  success: boolean;
  error?: string;
  stats?: {
    doorsCount: number;
    toolGroupsCount: number;
    toolsCount: number;
    cncDoorsCount: number;
    profilesCount: number;
  };
}

export interface ToolsValidateResult {
  toolGroups: boolean;
  toolLib: boolean;
  allPresent: boolean;
}

export function validateToolsFolder(toolsFolder: string): ToolsValidateResult {
  const toolGroups = existsSync(resolve(toolsFolder, 'ToolGroups.dat'));
  const toolLib = existsSync(resolve(toolsFolder, 'ToolLib.dat'));
  return { toolGroups, toolLib, allPresent: toolGroups && toolLib };
}

export function listLibraries(librariesFolder: string): string[] {
  try {
    return readdirSync(librariesFolder, { withFileTypes: true })
      .filter(entry => entry.isDirectory()
        && existsSync(resolve(librariesFolder, entry.name, 'Doors.dat')))
      .map(entry => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

export async function loadFromFolders(
  toolsFolder: string,
  librariesFolder: string,
  library: string,
  outputDir: string,
  projectRoot: string,
): Promise<LoadResult> {
  const paths = {
    doors: resolve(librariesFolder, library, 'Doors.dat'),
    toolGroups: resolve(toolsFolder, 'ToolGroups.dat'),
    toolLib: resolve(toolsFolder, 'ToolLib.dat'),
  };

  const missing: string[] = [];
  if (!existsSync(paths.doors)) missing.push(`${library}/Doors.dat (in libraries folder)`);
  if (!existsSync(paths.toolGroups)) missing.push('ToolGroups.dat (in tools folder)');
  if (!existsSync(paths.toolLib)) missing.push('ToolLib.dat (in tools folder)');

  if (missing.length > 0) {
    return {
      success: false,
      error: `Missing files:\n  - ${missing.join('\n  - ')}`,
    };
  }

  try {
    // Dynamic import from root package's compiled dist/
    // pathToFileURL required on Windows — Node ESM rejects bare absolute paths like C:\...
    const distDir = resolve(projectRoot, 'dist');
    const toURL = (p: string) => pathToFileURL(p).href;
    // Cache-bust so rebuilt dist/ is picked up without restarting Vite
    const bust = `?t=${Date.now()}`;
    const { parseDoors } = await import(/* @vite-ignore */ toURL(resolve(distDir, 'parsers', 'parseDoors.js')) + bust);
    const { parseToolGroups } = await import(/* @vite-ignore */ toURL(resolve(distDir, 'parsers', 'parseToolGroups.js')) + bust);
    const { parseToolLib } = await import(/* @vite-ignore */ toURL(resolve(distDir, 'parsers', 'parseToolLib.js')) + bust);
    const { buildGraph } = await import(/* @vite-ignore */ toURL(resolve(distDir, 'normalizers', 'buildGraph.js')) + bust);
    const { extractProfiles } = await import(/* @vite-ignore */ toURL(resolve(distDir, 'normalizers', 'extractProfiles.js')) + bust);

    // Parse
    const doors = parseDoors(readFileSync(paths.doors, 'utf-8'));
    const toolGroups = parseToolGroups(readFileSync(paths.toolGroups, 'utf-8'));
    const tools = parseToolLib(readFileSync(paths.toolLib, 'utf-8'));

    // Build graph + extract profiles
    const doorGraphs = buildGraph(doors, tools, toolGroups);
    const profiles = extractProfiles(tools);

    // Serialize graphs (mirrors cli.ts lines 131-152)
    const serializableGraphs = doorGraphs.map((dg: any) => ({
      doorName: dg.door.Name,
      doorType: dg.door.Type,
      operationCount: dg.operations.length,
      operations: dg.operations.map((op: any) => ({
        operationId: op.operation.ID,
        toolGroupId: op.operation.ToolGroupID,
        toolGroupName: op.toolGroup.group.Name,
        alignment: op.toolGroup.group.Alignment,
        depth: op.operation.Depth,
        flipSideOp: op.operation.FlipSideOp,
        toolCount: op.toolGroup.tools.length,
        tools: op.toolGroup.tools.map((t: any) => ({
          toolId: t.tool.ToolID,
          toolName: t.tool.Name,
          isCNCDoor: t.tool.AppCNCDoor,
          toolDiameter: t.tool.Dia,
          sharpCornerAngle: t.tool.SharpCornerAngle,
          entryDepth: t.entry.Depth,
          entryOffset: t.entry.Offset,
          flipSide: t.entry.FlipSide ?? false,
        })),
      })),
    }));

    // Write JSON files to output directory
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(resolve(outputDir, 'doors.json'), JSON.stringify(doors, null, 2));
    writeFileSync(resolve(outputDir, 'toolGroups.json'), JSON.stringify(toolGroups, null, 2));
    writeFileSync(resolve(outputDir, 'tools.json'), JSON.stringify(tools, null, 2));
    writeFileSync(resolve(outputDir, 'profiles.json'), JSON.stringify(profiles, null, 2));
    writeFileSync(resolve(outputDir, 'doorGraphs.json'), JSON.stringify(serializableGraphs, null, 2));

    const cncDoorsCount = doorGraphs.filter((dg: any) => dg.operations.length > 0).length;

    return {
      success: true,
      stats: {
        doorsCount: doors.length,
        toolGroupsCount: toolGroups.length,
        toolsCount: tools.length,
        cncDoorsCount,
        profilesCount: profiles.length,
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
