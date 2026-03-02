import { useState, useEffect, useCallback, useRef } from 'react';

// ---------------------------------------------------------------------------
// Types mirroring server/db.ts responses
// ---------------------------------------------------------------------------

export interface DoorStyleWithParams {
  id: string;
  displayName: string;
  sortOrder: number;
  params: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseConfigDataResult {
  matrix: DoorStyleWithParams[];
  loading: boolean;
  error: string | null;
  addStyle: (displayName: string) => Promise<void>;
  renameStyle: (styleId: string, newName: string) => Promise<void>;
  removeStyle: (styleId: string) => Promise<void>;
  updateParam: (styleId: string, paramKey: string, value: unknown) => void;
  reorderStyles: (styleIds: string[]) => void;
  paramOrder: string[] | null;
  reorderParams: (paramKeys: string[]) => void;
  refetch: () => void;
}

export function useConfigData(): UseConfigDataResult {
  const [matrix, setMatrix] = useState<DoorStyleWithParams[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paramOrder, setParamOrder] = useState<string[] | null>(null);

  // Debounce timers keyed by "styleId:paramKey"
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // Pending values for flush-on-unmount
  const pending = useRef(new Map<string, { styleId: string; paramKey: string; value: unknown }>());

  const fetchMatrix = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/config/matrix');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMatrix(data.styles ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load config');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMatrix(); }, [fetchMatrix]);

  // Fetch param order on mount
  useEffect(() => {
    fetch('/api/config/param-order')
      .then(r => r.json())
      .then(data => { if (data.paramOrder) setParamOrder(data.paramOrder); })
      .catch(() => {});
  }, []);

  // Flush pending saves on unmount
  useEffect(() => {
    return () => {
      for (const [key, timer] of timers.current) {
        clearTimeout(timer);
        const p = pending.current.get(key);
        if (p) {
          // Fire-and-forget save
          fetch(`/api/config/styles/${p.styleId}/params/${p.paramKey}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: p.value }),
          }).catch(() => {});
        }
      }
      timers.current.clear();
      pending.current.clear();
    };
  }, []);

  const addStyle = useCallback(async (displayName: string) => {
    try {
      const res = await fetch('/api/config/styles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setMatrix(prev => [...prev, data.style]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add style');
    }
  }, []);

  const renameStyle = useCallback(async (styleId: string, newName: string) => {
    // Optimistic rename
    setMatrix(prev => prev.map(s =>
      s.id === styleId ? { ...s, displayName: newName } : s,
    ));
    try {
      const res = await fetch(`/api/config/styles/${styleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: newName }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to rename style');
      fetchMatrix(); // Re-sync on failure
    }
  }, [fetchMatrix]);

  const removeStyle = useCallback(async (styleId: string) => {
    // Optimistic remove
    setMatrix(prev => prev.filter(s => s.id !== styleId));
    try {
      const res = await fetch(`/api/config/styles/${styleId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete style');
      fetchMatrix(); // Re-sync on failure
    }
  }, [fetchMatrix]);

  const updateParam = useCallback((styleId: string, paramKey: string, value: unknown) => {
    // Optimistic local update
    setMatrix(prev => prev.map(s =>
      s.id === styleId
        ? { ...s, params: { ...s.params, [paramKey]: value } }
        : s,
    ));

    const key = `${styleId}:${paramKey}`;
    pending.current.set(key, { styleId, paramKey, value });

    // Clear existing timer for this key
    const existing = timers.current.get(key);
    if (existing) clearTimeout(existing);

    // Debounce 300ms
    timers.current.set(key, setTimeout(async () => {
      timers.current.delete(key);
      pending.current.delete(key);
      try {
        await fetch(`/api/config/styles/${styleId}/params/${paramKey}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value }),
        });
      } catch {
        // Silent fail — data stays in local state, next full load will re-sync
      }
    }, 300));
  }, []);

  const reorderStyles = useCallback((styleIds: string[]) => {
    // Optimistic reorder
    setMatrix(prev => {
      const map = new Map(prev.map(s => [s.id, s]));
      return styleIds.map((id, i) => {
        const s = map.get(id);
        return s ? { ...s, sortOrder: i } : null;
      }).filter(Boolean) as DoorStyleWithParams[];
    });
    fetch('/api/config/styles/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ styleIds }),
    }).catch(() => { fetchMatrix(); });
  }, [fetchMatrix]);

  const reorderParams = useCallback((paramKeys: string[]) => {
    setParamOrder(paramKeys);
    fetch('/api/config/param-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paramOrder: paramKeys }),
    }).catch(() => {});
  }, []);

  return { matrix, loading, error, addStyle, renameStyle, removeStyle, updateParam, reorderStyles, paramOrder, reorderParams, refetch: fetchMatrix };
}
