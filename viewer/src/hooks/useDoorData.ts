import { useState, useEffect } from 'react';
import type { DoorData, DoorGraphData, ToolProfileData } from '../types.js';

interface DoorDataState {
  doors: DoorData[];
  graphs: DoorGraphData[];
  profiles: ToolProfileData[];
  loading: boolean;
  error: string | null;
}

export function useDoorData(): DoorDataState {
  const [state, setState] = useState<DoorDataState>({
    doors: [],
    graphs: [],
    profiles: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    async function load() {
      try {
        const [doorsRes, graphsRes, profilesRes] = await Promise.all([
          fetch('/data/doors.json'),
          fetch('/data/doorGraphs.json'),
          fetch('/data/profiles.json'),
        ]);
        const doors: DoorData[] = await doorsRes.json();
        const graphs: DoorGraphData[] = await graphsRes.json();
        const profiles: ToolProfileData[] = await profilesRes.json();

        // Filter to only CNC doors (Type=3 with RoutedLockedShape)
        const cncDoors = doors.filter(
          (d) => d.Type === 3 && d.RoutedLockedShape
        );

        setState({ doors: cncDoors, graphs, profiles, loading: false, error: null });
      } catch (e) {
        setState({
          doors: [],
          graphs: [],
          profiles: [],
          loading: false,
          error: e instanceof Error ? e.message : 'Failed to load data',
        });
      }
    }
    load();
  }, []);

  return state;
}
