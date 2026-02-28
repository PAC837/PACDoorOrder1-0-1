import { useState, useEffect, type CSSProperties } from 'react';

/** Number input that only commits its value on blur or Enter — avoids expensive re-renders per keystroke. */
export function CommitNumberInput({ value, onCommit, style, ...props }: {
  value: number;
  onCommit: (v: number) => void;
  style?: CSSProperties;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur' | 'onKeyDown' | 'type' | 'style'>) {
  const [local, setLocal] = useState(String(value));
  useEffect(() => setLocal(String(value)), [value]);
  const commit = () => { const n = Number(local); if (!isNaN(n)) onCommit(n); };
  return (
    <input
      type="number"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur(); } }}
      style={style}
      {...props}
    />
  );
}
