import { useState, useEffect } from 'react';
import type { DoorData, DoorGraphData, ToolProfileData, RawToolGroup, RawTool } from '../types.js';

interface DoorDataState {
  doors: DoorData[];
  graphs: DoorGraphData[];
  profiles: ToolProfileData[];
  toolGroups: RawToolGroup[];
  tools: RawTool[];
  loading: boolean;
  error: string | null;
}

export function useDoorData(reloadKey: number = 0): DoorDataState {
  const [state, setState] = useState<DoorDataState>({
    doors: [],
    graphs: [],
    profiles: [],
    toolGroups: [],
    tools: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    async function load() {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const [doorsRes, graphsRes, profilesRes, toolGroupsRes, toolsRes] = await Promise.all([
          fetch('/data/doors.json'),
          fetch('/data/doorGraphs.json'),
          fetch('/data/profiles.json'),
          fetch('/data/toolGroups.json'),
          fetch('/data/tools.json'),
        ]);
        const doors: DoorData[] = await doorsRes.json();
        const graphs: DoorGraphData[] = await graphsRes.json();
        const profiles: ToolProfileData[] = await profilesRes.json();
        const toolGroups: RawToolGroup[] = await toolGroupsRes.json();
        const tools: RawTool[] = await toolsRes.json();

        // Filter to only CNC doors (Type=3 with RoutedLockedShape)
        const cncDoors = doors.filter(
          (d) => d.Type === 3 && d.RoutedLockedShape
        );

        setState({ doors: cncDoors, graphs, profiles, toolGroups, tools, loading: false, error: null });
      } catch (e) {
        setState({
          doors: [],
          graphs: [],
          profiles: [],
          toolGroups: [],
          tools: [],
          loading: false,
          error: e instanceof Error ? e.message : 'Failed to load data',
        });
      }
    }
    load();
  }, [reloadKey]);

  return state;
}
