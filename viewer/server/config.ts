import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface SelectedTextures {
  painted: string | null;
  primed: string | null;
  raw: string | null;
  sanded: string | null;
}

export type TextureCategory = 'painted' | 'primed' | 'raw' | 'sanded';

export interface PacConfig {
  toolsFolderPath: string | null;
  librariesFolderPath: string | null;
  selectedLibrary: string | null;
  texturesFolderPath: string | null;
  selectedTextures: SelectedTextures;
  activeTextureCategory: TextureCategory;
  lastLoadedAt: string | null;
  lastLoadError: string | null;
}

const DEFAULT_TEXTURES: SelectedTextures = {
  painted: null,
  primed: null,
  raw: null,
  sanded: null,
};

const DEFAULT_CONFIG: PacConfig = {
  toolsFolderPath: null,
  librariesFolderPath: null,
  selectedLibrary: null,
  texturesFolderPath: null,
  selectedTextures: { ...DEFAULT_TEXTURES },
  activeTextureCategory: 'raw',
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
    // Migrate old single selectedTexture → per-category selectedTextures
    if (raw.selectedTexture && !raw.selectedTextures) {
      const old: string = raw.selectedTexture;
      const textures: SelectedTextures = { ...DEFAULT_TEXTURES };
      const prefix = old.split('/')[0]?.toLowerCase();
      if (prefix === 'painted' || prefix === 'primed' || prefix === 'raw' || prefix === 'sanded') {
        textures[prefix as TextureCategory] = old;
        raw.activeTextureCategory = prefix;
      }
      raw.selectedTextures = textures;
      delete raw.selectedTexture;
    }
    // Ensure selectedTextures has all 4 keys
    if (raw.selectedTextures) {
      raw.selectedTextures = { ...DEFAULT_TEXTURES, ...raw.selectedTextures };
    }
    return { ...DEFAULT_CONFIG, ...raw };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function writeConfig(viewerRoot: string, config: PacConfig): void {
  writeFileSync(configPath(viewerRoot), JSON.stringify(config, null, 2));
}
