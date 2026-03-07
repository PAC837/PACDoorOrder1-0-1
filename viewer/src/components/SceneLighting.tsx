import { useEffect, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SAOPass } from 'three/examples/jsm/postprocessing/SAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { HalftonePass } from 'three/examples/jsm/postprocessing/HalftonePass.js';
import { Environment } from '@react-three/drei';
import { getPreset } from '../lightingPresets.js';
import type { LightingPresetKey, EnvPresetKey } from '../hooks/useViewerSettings.js';

interface SceneLightingProps {
  presetKey: LightingPresetKey;
  envPreset?: EnvPresetKey;
  envIntensity?: number;
}

export function SceneLighting({ presetKey, envPreset, envIntensity = 1 }: SceneLightingProps) {
  const preset = getPreset(presetKey);
  const { gl, scene, camera, size } = useThree();
  const composerRef = useRef<EffectComposer | null>(null);

  // Build / tear-down EffectComposer when post-processing changes
  useEffect(() => {
    if (!preset.postProcessing) {
      if (composerRef.current) {
        composerRef.current.dispose();
        composerRef.current = null;
      }
      return;
    }

    const composer = new EffectComposer(gl);
    composer.addPass(new RenderPass(scene, camera));

    if (preset.postProcessing === 'ssao') {
      const sao = new SAOPass(scene, camera);
      sao.params.saoBias = 0.5;
      sao.params.saoIntensity = 0.015;
      sao.params.saoScale = 5;
      sao.params.saoKernelRadius = 50;
      composer.addPass(sao);
    } else if (preset.postProcessing === 'bloom') {
      const bloom = new UnrealBloomPass(
        new THREE.Vector2(size.width, size.height),
        0.3,   // strength (subtle)
        0.4,   // radius
        0.85,  // threshold
      );
      composer.addPass(bloom);
    } else if (preset.postProcessing === 'halftone') {
      const halftone = new HalftonePass({
        radius: 4,
        shape: 1,       // dot
        scatter: 0,
        blending: 1,
      });
      composer.addPass(halftone);
    }

    composer.addPass(new OutputPass());
    composerRef.current = composer;

    return () => {
      composer.dispose();
      composerRef.current = null;
    };
  }, [preset.postProcessing, gl, scene, camera, size.width, size.height]);

  // Resize composer when viewport changes
  useEffect(() => {
    composerRef.current?.setSize(size.width, size.height);
  }, [size.width, size.height]);

  // When composer is active, take over rendering (priority 1 disables R3F default)
  useFrame(() => {
    if (composerRef.current) {
      composerRef.current.render();
    }
  }, preset.postProcessing ? 1 : 0);

  return (
    <>
      <ambientLight color={preset.ambient.color} intensity={preset.ambient.intensity} />
      {preset.directionals.map((d, i) => (
        <directionalLight
          key={`${presetKey}-dir-${i}`}
          position={d.position}
          color={d.color}
          intensity={d.intensity}
        />
      ))}
      {envPreset && envPreset !== 'none' && (
        <Environment
          preset={envPreset}
          environmentIntensity={envIntensity}
        />
      )}
    </>
  );
}
