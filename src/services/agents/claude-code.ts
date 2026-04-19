import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { isAbsolute, join, resolve as resolvePath } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { ensureDataSubdir } from "../../lib/data-dir.ts";
import type {
  AgentConnection,
  AgentStatusInfo,
  AgentStatusListener,
  ClaudeCodeConfig,
} from "./types.ts";

/**
 * Expand `~` / `$HOME` / relative paths in a user-supplied cwd. The SDK
 * receives this string verbatim and passes it to child_process.spawn as the
 * subprocess cwd; shells aren't involved, so tildes and env vars don't
 * expand on their own.
 */
function expandPath(raw: string): string {
  let p = raw.trim();
  if (!p) return p;
  if (p === "~") p = homedir();
  else if (p.startsWith("~/")) p = join(homedir(), p.slice(2));
  // Expand $HOME and ${HOME} anywhere in the string.
  p = p.replace(/\$\{?HOME\}?/g, homedir());
  if (!isAbsolute(p)) p = resolvePath(p);
  return p;
}

/**
 * Resolve the SDK's bundled CLI script to an absolute path once at module
 * load. The SDK will try to discover this itself but its logic is fragile
 * under dev-watch and has been observed to ENOENT-with-misleading-message in
 * some restarts. Passing the path explicitly is more reliable.
 */
function resolveClaudeCli(): string | undefined {
  try {
    const req = createRequire(import.meta.url);
    const sdkPkg = req.resolve("@anthropic-ai/claude-agent-sdk/package.json");
    return join(sdkPkg, "..", "cli.js");
  } catch {
    return undefined;
  }
}

const CLAUDE_CLI_PATH = resolveClaudeCli();

/**
 * Claude Code agent connector — drives a local Claude Code session via the
 * Claude Agent SDK. The model runs remotely (api.anthropic.com) but tools,
 * session state, and orchestration are local.
 *
 * Design principle: don't touch the SDK defaults. Claude Code's own system
 * prompt, tool set, permission flow, and tool descriptions all ship as-is.
 * A Langouste conversation with this connector behaves like the regular
 * `claude` CLI — same capabilities, same persona.
 *
 * Optional config:
 *   - model: pin a specific Claude model.
 *   - cwd:   working directory Claude Code operates in. Defaults to an
 *            isolated scratch dir under the Langouste data dir so sessions
 *            aren't parked inside this codebase.
 *   - system_prompt: advanced override. Use with care — overriding the
 *            system prompt disables Claude Code's built-in tool guidance.
 *
 * First sendMessage starts a session; subsequent messages resume it via
 * session_id, preserving full conversation history.
 */

function allocateScratchDir(): string {
  const root = ensureDataSubdir("sessions");
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export class ClaudeCodeAgent implements AgentConnection {
  private systemPrompt: string | undefined;
  private model: string | undefined;
  private cwd: string;
  private additionalDirectories: string[];
  private sessionId: string | undefined;

  constructor(agentConfig: ClaudeCodeConfig) {
    this.systemPrompt = agentConfig.system_prompt?.trim() || undefined;
    this.model = agentConfig.model;

    const rawCwd = agentConfig.cwd?.trim();
    if (rawCwd) {
      const expanded = expandPath(rawCwd);
      if (!existsSync(expanded)) {
        throw new Error(
          `Claude Code working directory does not exist: ${expanded} (from "${rawCwd}"). ` +
            `Set an absolute path or leave the field blank to use an isolated scratch dir.`,
        );
      }
      this.cwd = expanded;
    } else {
      this.cwd = allocateScratchDir();
    }

    this.additionalDirectories = (agentConfig.additional_directories ?? [])
      .map((p) => p.trim())
      .filter(Boolean)
      .map(expandPath);
  }

  getStatus(): AgentStatusInfo {
    return {
      status: this.sessionId ? "connected" : "disconnected",
      detail: this.sessionId ? `session ${this.sessionId.slice(0, 8)}` : undefined,
      since: new Date(),
      failedAttempts: 0,
    };
  }

  onStatusChange(_listener: AgentStatusListener): void {
    // Stateless from the caller's perspective — session lifecycle is internal
  }

  async sendMessage(text: string): Promise<string> {
    const options: Parameters<typeof query>[0]["options"] = {
      cwd: this.cwd,
      stderr: (data) => console.error(`[ClaudeCode stderr] ${data}`),
    };

    if (CLAUDE_CLI_PATH) options.pathToClaudeCodeExecutable = CLAUDE_CLI_PATH;

    if (this.systemPrompt) options.systemPrompt = this.systemPrompt;
    if (this.model) options.model = this.model;
    if (this.additionalDirectories.length > 0) {
      options.additionalDirectories = this.additionalDirectories;
    }
    if (this.sessionId) options.resume = this.sessionId;

    console.log(
      `[ClaudeCode] sendMessage prompt="${text.slice(0, 80)}" resume=${this.sessionId ?? "none"} cwd=${this.cwd}`,
    );

    let finalText = "";

    try {
      for await (const msg of query({ prompt: text, options })) {
        const subtype = "subtype" in msg ? `/${msg.subtype}` : "";
        console.log(`[ClaudeCode] ← ${msg.type}${subtype} ${JSON.stringify(msg).slice(0, 500)}`);
        if (msg.type === "result") {
          this.sessionId = msg.session_id;
          if (msg.subtype === "success") {
            finalText = msg.result;
          } else {
            const errs = (msg as { errors?: string[] }).errors ?? [msg.subtype];
            console.error(`[ClaudeCode] turn failed subtype=${msg.subtype} full=${JSON.stringify(msg)}`);
            throw new Error(`Claude Code turn failed: ${errs.join("; ")}`);
          }
        }
      }
    } catch (err) {
      const detail = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
      console.error(`[ClaudeCode] sendMessage threw: ${detail}`);
      throw err;
    }

    console.log(`[ClaudeCode] final text length=${finalText.length} session=${this.sessionId?.slice(0, 8) ?? "none"}`);
    return finalText;
  }

  disconnect(): void {
    // Sessions persist on disk at ~/.claude/projects/...; nothing to tear down.
    // Clearing sessionId means the next sendMessage starts fresh.
    this.sessionId = undefined;
  }
}
