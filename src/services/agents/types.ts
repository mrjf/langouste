export type AgentStatus = "disconnected" | "connecting" | "connected" | "error";

export interface AgentStatusInfo {
  status: AgentStatus;
  /** Human-readable detail (e.g., error message, URL) */
  detail?: string;
  /** Timestamp of last status change */
  since: Date;
  /** Number of consecutive failed connection attempts */
  failedAttempts: number;
}

export type AgentStatusListener = (info: AgentStatusInfo) => void;

export interface AgentConnection {
  /** Send a message to the agent and get its response */
  sendMessage(text: string, conversationHistory?: Array<{ role: string; content: string }>): Promise<string>;
  /** Clean up any persistent connections and stop reconnecting */
  disconnect(): void;
  /** Current connection status */
  getStatus(): AgentStatusInfo;
  /** Register a listener for status changes */
  onStatusChange(listener: AgentStatusListener): void;
}

export interface OpenClawConfig {
  url: string; // ws://host:18789
  device_name?: string;
}

export interface ClaudeConfig {
  model?: string; // defaults to claude-sonnet-4-20250514
  system_prompt?: string;
  api_key?: string; // if not set, uses the app's ANTHROPIC_API_KEY
}

export interface ClaudeCodeConfig {
  model?: string; // optional Claude model pin
  // Advanced override; leave unset to use Claude Code's own system prompt.
  // Overriding disables Claude Code's built-in tool guidance.
  system_prompt?: string;
  // Working directory for the session. Defaults to an isolated scratch dir
  // under the Langouste data directory. Set to your project's absolute path
  // for the regular "cd && claude" behaviour.
  cwd?: string;
  // Extra absolute paths Claude Code may read beyond cwd. Use sparingly.
  additional_directories?: string[];
}

export interface HttpConfig {
  url: string; // POST endpoint
  headers?: Record<string, string>;
  body_template?: string; // JSON template with {{message}} placeholder
  response_path?: string; // JSONPath to extract response, e.g. "choices[0].message.content"
}
