const BASE_URL = '';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  getStats: () => request<import('../types').Stats>('/stats'),
  
  getTools: () => request<import('../types').Tool[]>('/tools'),
  
  clear: () => request<{ ok: boolean }>('/clear', { method: 'POST' }),
  
  getProviders: () => request<{ ok: boolean; providers: import('../types').ProviderConfig[] }>('/providers'),
  
  saveProviders: (providers: import('../types').ProviderConfig[]) =>
    request<{ ok: boolean; count: number }>('/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providers }),
    }),
  
  testProvider: (index: number) =>
    request<import('../types').TestProviderResult>(`/providers/test?index=${index}`),
  
  getWorkspace: () => request<{ path: string }>('/workspace'),
  
  setWorkspace: (path: string) =>
    request<{ ok: boolean; path: string; error?: string }>('/workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    }),
  
  browse: (path: string) =>
    request<import('../types').BrowseResult>(`/browse?path=${encodeURIComponent(path)}`),
  
  getGitInfo: () => request<import('../types').GitInfo>('/git/info'),
  
  getGitLog: () => request<import('../types').CommitEntry[]>('/git/log'),
  
  getGitBranches: () => request<import('../types').GitBranchesResult>('/git/branches'),
  
  gitAdd: (files: string) =>
    request<{ ok: boolean; out: string }>('/git/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files }),
    }),
  
  gitRestore: (files: string, staged: boolean) =>
    request<{ ok: boolean; out: string }>('/git/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files, staged }),
    }),
  
  gitRemove: (files: string) =>
    request<{ ok: boolean; out: string }>('/git/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files }),
    }),
  
  gitCommit: (message: string) =>
    request<{ ok: boolean; out: string }>('/git/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    }),
  
  gitCheckout: (branch: string) =>
    request<{ ok: boolean; out: string }>('/git/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch }),
    }),
  
  gitCreateBranch: (name: string, from?: string) =>
    request<{ ok: boolean; out: string }>('/git/branch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, from }),
    }),
  
  gitInit: () =>
    request<{ ok: boolean; out: string }>('/git/init', { method: 'POST' }),
  
  getNotes: () => request<{ content: string }>('/notes'),
  
  saveNote: (content: string, title?: string) =>
    request<{ ok: boolean }>('/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, title }),
    }),
  
  deleteNote: (index: number) =>
    request<{ ok: boolean }>(`/notes/${index}`, { method: 'DELETE' }),
  
  deleteAllNotes: () => request<{ ok: boolean }>('/notes', { method: 'DELETE' }),
  
  getAgents: () => request<import('../types').Agent[]>('/agents'),
  
  sendMessage: (message: string, agent?: import('../App').AgentType) =>
    fetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, agent }),
    }),
  
  confirmTool: (id: string, approved: boolean) =>
    request<{ ok: boolean }>('/chat/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, approved }),
    }),
};
