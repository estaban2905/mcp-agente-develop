export interface Tool {
  name: string;
  description?: string;
}

export interface Stats {
  model: string;
  provider: string;
  messages: number;
  iterations: number;
  toolCalls: number;
  providers?: ProviderInfo[];
}

export interface ProviderInfo {
  name: string;
  model: string;
  healthy: boolean;
  active: boolean;
  failures: number;
  openUntilMs: number;
  lastErrorCode?: number;
}

export interface ProviderConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  headers: string;
  enabled: boolean;
}

export interface GitFile {
  file: string;
  status: string;
}

export interface GitInfo {
  project: string;
  branch: string;
  staged: GitFile[];
  unstaged: GitFile[];
  untracked: GitFile[];
  error?: string;
}

export interface CommitEntry {
  hash: string;
  date: string;
  message: string;
}

export interface GitBranchesResult {
  ok: boolean;
  branches: string[];
  error?: string;
}

export interface Note {
  title: string;
  date: string;
  body: string;
}

export interface BrowseResult {
  path: string;
  dirs: string[];
  error?: string;
}

export interface SSEEvent {
  type: 'tool' | 'done' | 'error' | 'confirm' | 'providerSwitch';
  name?: string;
  args?: Record<string, unknown>;
  content?: string;
  iterations?: number;
  toolCalls?: number;
  message?: string;
  id?: string;
  toolName?: string;
  from?: string;
  reason?: string;
  approved?: boolean;
}

export interface TestProviderResult {
  ok: boolean;
  latencyMs?: number;
  errorCode?: number;
  error?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'agent';
  content: string;
  model?: string;
  timestamp: number;
  isTyping?: boolean;
  isToolCall?: boolean;
  toolCall?: ToolCall;
  isProviderSwitch?: boolean;
  providerSwitch?: { from: string; to: string };
  doneMeta?: { iterations: number; toolCalls: number };
  isError?: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: 'running' | 'done' | 'error';
  result?: string;
}

export interface ConfirmEvent {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface Agent {
  id: string;
  name: string;
  description: string;
}
