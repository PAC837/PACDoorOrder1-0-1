import { useState, useEffect } from 'react';

export interface ColumnDef {
  id: string;
  label: string;
  visible: boolean;
  width: number;
  isCustom?: boolean;  // user-created free-text column
}

export const DEFAULT_COLUMNS: ColumnDef[] = [
  { id: 'qty',       label: 'QTY',        visible: true, width: 40 },
  { id: 'height',    label: 'Height',     visible: true, width: 58 },
  { id: 'width',     label: 'Width',      visible: true, width: 58 },
  { id: 'partType',  label: 'Part Type',  visible: true, width: 64 },
  { id: 'doorStyle', label: 'Door Style', visible: true, width: 110 },
  { id: 'finish',    label: 'Finish',     visible: true, width: 56 },
  { id: 'roomName',  label: 'Room Name',  visible: true, width: 80 },
  { id: 'cabNumber', label: 'Cab #',      visible: true, width: 64 },
  { id: 'material',  label: 'Material',   visible: true, width: 80 },
  { id: 'note',      label: 'Note',       visible: true, width: 80 },
  { id: 'profile',   label: 'Profile',    visible: true, width: 44 },
  { id: 'hinges',    label: 'Hinges',     visible: true, width: 50 },
  { id: 'hardware',  label: 'H/W',        visible: true, width: 36 },
  { id: 'price',     label: 'Price',      visible: true, width: 54 },
  { id: 'subtotal',  label: 'Subtotal',   visible: true, width: 62 },
];

const DEFAULT_IDS = new Set(DEFAULT_COLUMNS.map(c => c.id));

export function useOrderColumns() {
  const [columns, setColumns] = useState<ColumnDef[]>(() => {
    try {
      const s = localStorage.getItem('pac-order-columns');
      if (s) {
        const saved: ColumnDef[] = JSON.parse(s);
        const savedMap = new Map(saved.map(c => [c.id, c]));
        // Built-in columns in DEFAULT_COLUMNS order, with saved overrides
        const builtIn = DEFAULT_COLUMNS.map(d => savedMap.get(d.id) ?? d);
        // Append any saved custom columns
        const custom = saved.filter(c => c.isCustom && !DEFAULT_IDS.has(c.id));
        return [...builtIn, ...custom];
      }
    } catch { /* ignore */ }
    return DEFAULT_COLUMNS;
  });

  useEffect(() => {
    localStorage.setItem('pac-order-columns', JSON.stringify(columns));
  }, [columns]);

  return { columns, setColumns };
}
