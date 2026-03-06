import { useState, useEffect } from 'react';

export type LightingPresetKey =
  | 'studio' | 'dramatic' | 'flat' | 'warm-workshop' | 'cool-daylight'
  | 'rim-backlit' | 'three-point' | 'ambient-occlusion' | 'bloom' | 'halftone'
  | 'raking';

export interface ViewerSettings {
  modelOpacity: number;        // 0–1
  lightingPreset: LightingPresetKey;
}

const DEFAULT_SETTINGS: ViewerSettings = {
  modelOpacity: 1,
  lightingPreset: 'studio',
};

export function useViewerSettings() {
  const [viewerSettings, setViewerSettings] = useState<ViewerSettings>(() => {
    try {
      const s = localStorage.getItem('pac-viewer-settings');
      if (s) return { ...DEFAULT_SETTINGS, ...JSON.parse(s) };
    } catch { /* ignore */ }
    return { ...DEFAULT_SETTINGS };
  });

  useEffect(() => {
    localStorage.setItem('pac-viewer-settings', JSON.stringify(viewerSettings));
  }, [viewerSettings]);

  return { viewerSettings, setViewerSettings };
}
