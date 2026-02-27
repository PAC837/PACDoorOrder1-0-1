import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface PacConfig {
  toolsFolderPath: string | null;
  librariesFolderPath: string | null;
  selectedLibrary: string | null;
  lastLoadedAt: string | null;
  lastLoadError: string | null;
}

const DEFAULT_CONFIG: PacConfig = {
  toolsFolderPath: null,
  librariesFolderPath: null,
  selectedLibrary: null,
  lastLoadedAt: null,
  lastLoadError: null,
};

function configPath(viewerRoot: string): string {
  return resolve(viewerRoot, '.pac-config.json');
}

export function readConfig(viewerRoot: string): PacConfig {
  const p = configPath(viewerRoot);
  if (!existsSync(p)) return { ...DEFAULT_CONFIG };
  try {
    const raw = JSON.parse(readFileSync(p, 'utf-8'));
    // Migrate old single-folder config
    if (raw.cncFolderPath && !raw.toolsFolderPath) {
      raw.toolsFolderPath = raw.cncFolderPath;
      delete raw.cncFolderPath;
    }
    return { ...DEFAULT_CONFIG, ...raw };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function writeConfig(viewerRoot: string, config: PacConfig): void {
  writeFileSync(configPath(viewerRoot), JSON.stringify(config, null, 2));
}
