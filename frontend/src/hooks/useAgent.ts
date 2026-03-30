import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import type { Stats, Tool, ProviderConfig, ProviderInfo } from '../types';

export function useAgent() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [tools, setTools] = useState<Tool[]>([]);
  const [workspace, setWorkspace] = useState<string>('');
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [runtimeProviders, setRuntimeProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshStats = useCallback(async () => {
    try {
      const s = await api.getStats();
      setStats(s);
      if (s.providers) {
        setRuntimeProviders(s.providers);
      }
    } catch (err) {
      console.error('Error fetching stats:', err);
    }
  }, []);

  const loadTools = useCallback(async () => {
    try {
      const t = await api.getTools();
      setTools(t);
    } catch (err) {
      console.error('Error fetching tools:', err);
    }
  }, []);

  const loadWorkspace = useCallback(async () => {
    try {
      const { path } = await api.getWorkspace();
      setWorkspace(path);
    } catch (err) {
      console.error('Error fetching workspace:', err);
    }
  }, []);

  const loadProviders = useCallback(async () => {
    try {
      const data = await api.getProviders();
      setProviders(data.providers || []);
    } catch (err) {
      console.error('Error fetching providers:', err);
    }
  }, []);

  const saveProviders = useCallback(async (newProviders: ProviderConfig[]) => {
    await api.saveProviders(newProviders);
    setProviders(newProviders);
    await refreshStats();
  }, [refreshStats]);

  const testProvider = useCallback(async (index: number) => {
    return api.testProvider(index);
  }, []);

  const initialize = useCallback(async () => {
    setLoading(true);
    await Promise.all([
      refreshStats(),
      loadTools(),
      loadWorkspace(),
      loadProviders(),
    ]);
    setLoading(false);
  }, [refreshStats, loadTools, loadWorkspace, loadProviders]);

  useEffect(() => {
    initialize();

    const interval = setInterval(() => {
      if (!stats || !stats.model) {
        refreshStats();
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [initialize, refreshStats, stats]);

  return {
    stats,
    tools,
    workspace,
    providers,
    runtimeProviders,
    loading,
    refreshStats,
    loadTools,
    loadWorkspace,
    loadProviders,
    saveProviders,
    testProvider,
    initialize,
  };
}
