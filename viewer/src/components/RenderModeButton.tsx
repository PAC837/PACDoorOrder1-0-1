import type { RenderMode } from '../types.js';

const MODES: RenderMode[] = ['ghosted', 'solid', 'wireframe'];

const MODE_LABELS: Record<RenderMode, string> = {
  ghosted: 'Ghost',
  solid: 'Solid',
  wireframe: 'Wire',
};

/** SVG icons for each render mode. */
function ModeIcon({ mode }: { mode: RenderMode }) {
  if (mode === 'solid') {
    // Filled cube
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" stroke="currentColor" strokeWidth="0.5">
        <polygon points="7,1 13,4 13,10 7,13 1,10 1,4" />
      </svg>
    );
  }
  if (mode === 'ghosted') {
    // Semi-transparent cube (outlined with interior line)
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="7,1 13,4 13,10 7,13 1,10 1,4" opacity="0.3" fill="currentColor" />
        <polygon points="7,1 13,4 13,10 7,13 1,10 1,4" />
        <line x1="7" y1="7" x2="7" y2="13" />
        <line x1="7" y1="7" x2="1" y2="4" />
        <line x1="7" y1="7" x2="13" y2="4" />
      </svg>
    );
  }
  // wireframe — cube outline only
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="7,1 13,4 13,10 7,13 1,10 1,4" />
      <line x1="7" y1="7" x2="7" y2="13" />
      <line x1="7" y1="7" x2="1" y2="4" />
      <line x1="7" y1="7" x2="13" y2="4" />
    </svg>
  );
}

const btnStyle: React.CSSProperties = {
  padding: '4px 8px',
  borderRadius: 4,
  border: '1px solid #999',
  background: '#fff',
  color: '#333',
  fontSize: '11px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
};

export function RenderModeButton({ mode, onToggle }: { mode: RenderMode; onToggle: () => void }) {
  return (
    <button onClick={onToggle} style={btnStyle} title={`Render: ${MODE_LABELS[mode]} (click to cycle)`}>
      <ModeIcon mode={mode} />
      {MODE_LABELS[mode]}
    </button>
  );
}

/** Cycle to the next render mode. */
export function nextRenderMode(current: RenderMode): RenderMode {
  const idx = MODES.indexOf(current);
  return MODES[(idx + 1) % MODES.length];
}
