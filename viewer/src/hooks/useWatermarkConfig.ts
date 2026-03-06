import { useState, useEffect } from 'react';

export interface WatermarkConfig {
  text: string;
  size: 'small' | 'medium' | 'large';
  opacity: number;
}

const SIZE_PX: Record<WatermarkConfig['size'], number> = {
  small: 60,
  medium: 90,
  large: 130,
};

export function watermarkFontSize(size: WatermarkConfig['size']): number {
  return SIZE_PX[size];
}

export function useWatermarkConfig() {
  const [watermarkConfig, setWatermarkConfig] = useState<WatermarkConfig>(() => {
    try {
      const s = localStorage.getItem('pac-cs-watermark');
      if (s) return JSON.parse(s);
    } catch { /* ignore */ }
    return { text: '', size: 'medium', opacity: 0.12 };
  });

  useEffect(() => {
    localStorage.setItem('pac-cs-watermark', JSON.stringify(watermarkConfig));
  }, [watermarkConfig]);

  return { watermarkConfig, setWatermarkConfig };
}
