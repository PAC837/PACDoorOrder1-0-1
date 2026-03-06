import { useState, useEffect } from 'react';

export interface GroupByField {
  id: string;      // field identifier
  label: string;   // display name in admin
  active: boolean; // whether it contributes to grouping
}

export const DEFAULT_GROUP_BY: GroupByField[] = [
  { id: 'doorType',  label: 'Door Type',  active: true  },
  { id: 'finish',    label: 'Finish',     active: true  },
  { id: 'panelType', label: 'Panel Type', active: false },
  { id: 'material',  label: 'Material',   active: false },
  { id: 'roomName',  label: 'Room Name',  active: false },
  { id: 'cabNumber', label: 'Cab #',      active: false },
];

export function useGroupByConfig() {
  const [groupByFields, setGroupByFields] = useState<GroupByField[]>(() => {
    try {
      const s = localStorage.getItem('pac-group-by');
      if (s) {
        const saved: GroupByField[] = JSON.parse(s);
        const savedMap = new Map(saved.map(f => [f.id, f]));
        return DEFAULT_GROUP_BY.map(d => savedMap.get(d.id) ?? d);
      }
    } catch { /* ignore */ }
    return DEFAULT_GROUP_BY;
  });

  useEffect(() => {
    localStorage.setItem('pac-group-by', JSON.stringify(groupByFields));
  }, [groupByFields]);

  return { groupByFields, setGroupByFields };
}
