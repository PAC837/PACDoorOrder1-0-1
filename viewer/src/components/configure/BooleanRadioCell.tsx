interface BooleanRadioCellProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

export function BooleanRadioCell({ enabled, onChange }: BooleanRadioCellProps) {
  return (
    <div style={wrapStyle}>
      <input
        type="checkbox"
        checked={enabled}
        onChange={e => onChange(e.target.checked)}
        style={checkboxStyle}
      />
    </div>
  );
}

const wrapStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
};

const checkboxStyle: React.CSSProperties = {
  width: 16,
  height: 16,
  cursor: 'pointer',
  accentColor: '#5577aa',
};
