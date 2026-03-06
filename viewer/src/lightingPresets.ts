import type { LightingPresetKey } from './hooks/useViewerSettings.js';

export interface DirectionalLightDef {
  position: [number, number, number];
  color: string;
  intensity: number;
}

export interface LightingPresetDef {
  key: LightingPresetKey;
  label: string;
  description: string;
  ambient: { color: string; intensity: number };
  directionals: DirectionalLightDef[];
  background?: string;
  materialOverrides?: { roughness?: number; metalness?: number };
  postProcessing?: 'ssao' | 'bloom' | 'halftone' | null;
}

export const LIGHTING_PRESETS: LightingPresetDef[] = [
  {
    key: 'studio',
    label: 'Studio',
    description: 'Clean, neutral default lighting',
    ambient: { color: '#ffffff', intensity: 0.4 },
    directionals: [
      { position: [500, 800, 1000], color: '#ffffff', intensity: 0.8 },
      { position: [-300, 400, -500], color: '#ffffff', intensity: 0.3 },
    ],
  },
  {
    key: 'dramatic',
    label: 'Dramatic',
    description: 'Strong key light, deep shadows',
    ambient: { color: '#ffffff', intensity: 0.1 },
    directionals: [
      { position: [400, 900, 600], color: '#ffffff', intensity: 1.2 },
    ],
  },
  {
    key: 'flat',
    label: 'Flat',
    description: 'Even lighting, no shadows',
    ambient: { color: '#ffffff', intensity: 0.8 },
    directionals: [],
  },
  {
    key: 'warm-workshop',
    label: 'Warm Workshop',
    description: 'Warm incandescent workshop feel',
    ambient: { color: '#FFF5E6', intensity: 0.35 },
    directionals: [
      { position: [300, 700, 500], color: '#FFEEDD', intensity: 0.7 },
      { position: [-200, 500, -300], color: '#FFE8CC', intensity: 0.2 },
    ],
    materialOverrides: { roughness: 0.85 },
  },
  {
    key: 'cool-daylight',
    label: 'Cool Daylight',
    description: 'Blue-white north-facing window light',
    ambient: { color: '#E8F0FF', intensity: 0.35 },
    directionals: [
      { position: [0, 1000, 200], color: '#F0F4FF', intensity: 0.9 },
    ],
  },
  {
    key: 'rim-backlit',
    label: 'Rim Light',
    description: 'Backlit silhouette highlighting edges',
    ambient: { color: '#ffffff', intensity: 0.15 },
    directionals: [
      { position: [-200, -300, -800], color: '#ffffff', intensity: 1.0 },
      { position: [200, -200, -600], color: '#ffffff', intensity: 0.5 },
    ],
  },
  {
    key: 'three-point',
    label: 'Three-Point',
    description: 'Classic key / fill / back photography',
    ambient: { color: '#ffffff', intensity: 0.15 },
    directionals: [
      { position: [600, 800, 800], color: '#ffffff', intensity: 0.9 },
      { position: [-500, 600, 600], color: '#ffffff', intensity: 0.4 },
      { position: [0, 300, -700], color: '#ffffff', intensity: 0.6 },
    ],
  },
  {
    key: 'ambient-occlusion',
    label: 'Ambient Occlusion',
    description: 'Enhanced depth in creases and cavities',
    ambient: { color: '#ffffff', intensity: 0.4 },
    directionals: [
      { position: [500, 800, 1000], color: '#ffffff', intensity: 0.8 },
      { position: [-300, 400, -500], color: '#ffffff', intensity: 0.3 },
    ],
    postProcessing: 'ssao',
  },
  {
    key: 'bloom',
    label: 'Soft Glow',
    description: 'Subtle bloom on bright areas',
    ambient: { color: '#ffffff', intensity: 0.4 },
    directionals: [
      { position: [500, 800, 1000], color: '#ffffff', intensity: 0.8 },
      { position: [-300, 400, -500], color: '#ffffff', intensity: 0.3 },
    ],
    postProcessing: 'bloom',
  },
  {
    key: 'halftone',
    label: 'Halftone',
    description: 'Technical illustration dot pattern',
    ambient: { color: '#ffffff', intensity: 0.45 },
    directionals: [
      { position: [500, 800, 1000], color: '#ffffff', intensity: 0.75 },
    ],
    postProcessing: 'halftone',
  },
  {
    key: 'raking',
    label: 'Raking',
    description: 'Steep-angle light reveals CNC cuts and profiles',
    ambient: { color: '#ffffff', intensity: 0.2 },
    directionals: [
      { position: [800, 200, 150], color: '#ffffff', intensity: 1.0 },
      { position: [-400, -100, 100], color: '#ffffff', intensity: 0.15 },
    ],
  },
];

export function getPreset(key: LightingPresetKey): LightingPresetDef {
  return LIGHTING_PRESETS.find(p => p.key === key) ?? LIGHTING_PRESETS[0];
}
