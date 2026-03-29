// =============================================
//   Tipos compartidos del proyecto
// =============================================

import type OpenAI from "openai";

// ─── MCP Tool types ───────────────────────────────────────────────────────────

export interface ToolContent {
  type: "text";
  text: string;
}

export interface ToolResult {
  [key: string]: unknown;
  content: ToolContent[];
  isError?: boolean;
}

// ─── LLM / OpenAI message types ──────────────────────────────────────────────

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: MessageRole;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// ─── Provider types ───────────────────────────────────────────────────────────

export interface Provider {
  name: string;
  model: string;
  client: OpenAI;
  failures: number;
  openUntil: number;
}

export interface ProviderInfo {
  index: number;
  name: string;
  active: boolean;
  healthy: boolean;
  failures: number;
}

export interface ProviderSwitchEvent {
  type: "providerSwitch";
  from: string;
  reason: string;
}

// ─── Agent types ──────────────────────────────────────────────────────────────

export interface AgentStats {
  messages: number;
  iterations: number;
  toolCalls: number;
  model: string;
  provider: string;
  providers: ProviderInfo[];
}

export interface DoneEvent {
  content: string;
  iterations: number;
  toolCalls: number;
}

export interface ToolEvent {
  name: string;
  args: Record<string, unknown>;
}

// ─── Error types ──────────────────────────────────────────────────────────────

export interface LLMError extends Error {
  status?: number;
  _rotatable?: boolean;
  isToolValidationError?: boolean;
  isContextTooLarge?: boolean;
  allFailed?: boolean;
}

// ─── Tool parameter types ─────────────────────────────────────────────────────

export interface ReadFileParams {
  path: string;
}

export interface WriteFileParams {
  path: string;
  content: string;
  create_dirs?: boolean;
}

export interface ListDirectoryParams {
  path?: string;
  recursive?: boolean;
}

export interface DeleteFileParams {
  path: string;
}

export interface CreateDirectoryParams {
  path: string;
}

export interface RunCommandParams {
  command: string;
  cwd?: string;
  timeout?: number;
}

export interface GitBaseParams {
  path?: string;
}

export interface GitAddParams extends GitBaseParams {
  files?: string | string[];
}

export interface GitCommitParams extends GitBaseParams {
  message: string;
}

export interface GitLogParams extends GitBaseParams {
  limit?: number;
}

export interface GitExecResult {
  stdout: string;
  stderr: string;
  success: boolean;
}

export interface ApplyDiffParams {
  path: string;
  diff: string;
}

export interface SearchFilesParams {
  pattern: string;
  path?: string;
  include?: string;
  case_sensitive?: boolean;
}

export interface ReadFileRangeParams {
  path: string;
  start_line: number;
  end_line: number;
}

export interface AppendFileParams {
  path: string;
  content: string;
}

export interface RenameFileParams {
  path: string;
  new_name: string;
}

export interface MoveFileParams {
  path: string;
  destination: string;
}

export interface CopyFileParams {
  path: string;
  destination: string;
}

export interface ReplaceInFileParams {
  path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

export interface GitDiffParams {
  path?: string;
  staged?: boolean;
  file?: string;
}

export interface GitBranchParams {
  path?: string;
  name?: string;
  action?: "list" | "create" | "delete";
}

export interface GitCheckoutParams {
  path?: string;
  target: string;
  create?: boolean;
}

export interface GitRestoreFilesParams {
  path?: string;
  files?: string | string[];
  staged?: boolean;
}

export interface RunTestsParams {
  path?: string;
  command?: string;
}

// ─── Web types ────────────────────────────────────────────────────────────────

export interface GitPanelResult {
  ok: boolean;
  out: string;
}

export interface GitFileEntry {
  file: string;
  status?: string;
}

export interface GitInfoResponse {
  project: string;
  branch: string;
  staged: GitFileEntry[];
  unstaged: GitFileEntry[];
  untracked: GitFileEntry[];
}

export interface CommitEntry {
  hash: string;
  date: string;
  message: string;
}

export interface WorkspaceBody {
  path?: string;
}

export interface ChatBody {
  message?: string;
}

export interface GitAddBody {
  files?: string | string[];
}

export interface GitRestoreBody {
  files?: string | string[];
  staged?: boolean;
}

export interface GitCommitBody {
  message?: string;
}
