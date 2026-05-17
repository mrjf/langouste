<script lang="ts">
  import type { AgentConnector } from "../lib/stores.svelte";

  type ConnectorType = "claude" | "claude-code" | "openclaw" | "http";

  interface SavePayload {
    name: string;
    type: ConnectorType;
    config: Record<string, unknown>;
  }

  interface Props {
    initial?: AgentConnector | null;
    saveLabel?: string;
    onsave: (payload: SavePayload) => void | Promise<void>;
    oncancel: () => void;
    saving?: boolean;
  }

  let { initial = null, saveLabel = "Save", onsave, oncancel, saving = false }: Props = $props();

  const CLAUDE_MODELS = [
    { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
  ];

  // Editing: type is immutable. Creating: starts at claude.
  const isEdit = !!initial;
  let agentType: ConnectorType = $state(
    (initial?.type as ConnectorType) ?? "claude",
  );

  const initConfig = (initial?.config ?? {}) as Record<string, unknown>;

  let agentName = $state(initial?.name ?? "");
  let agentModel = $state((initConfig.model as string) ?? "claude-sonnet-4-6");
  let agentSystemPrompt = $state((initConfig.system_prompt as string) ?? "");
  let agentUrl = $state((initConfig.url as string) ?? "");
  let agentCwd = $state((initConfig.cwd as string) ?? "");
  let agentAdditionalDirs = $state(
    Array.isArray(initConfig.additional_directories)
      ? (initConfig.additional_directories as string[]).join("\n")
      : "",
  );
  let agentDeviceName = $state((initConfig.device_name as string) ?? "langouste");
  let agentToken = $state((initConfig.token as string) ?? "");
  let agentBootstrapToken = $state((initConfig.bootstrap_token as string) ?? "");

  function buildPayload(): SavePayload {
    const config: Record<string, unknown> = {};
    if (agentType === "claude") {
      config.model = agentModel;
      if (agentSystemPrompt.trim()) config.system_prompt = agentSystemPrompt.trim();
    } else if (agentType === "claude-code") {
      if (agentSystemPrompt.trim()) config.system_prompt = agentSystemPrompt.trim();
      if (agentCwd.trim()) config.cwd = agentCwd.trim();
      const extras = agentAdditionalDirs
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (extras.length > 0) config.additional_directories = extras;
    } else if (agentType === "openclaw") {
      config.url = agentUrl.trim() || "ws://127.0.0.1:18789";
      if (agentDeviceName.trim()) config.device_name = agentDeviceName.trim();
      if (agentToken.trim()) config.token = agentToken.trim();
      if (agentBootstrapToken.trim()) config.bootstrap_token = agentBootstrapToken.trim();
    } else if (agentType === "http") {
      config.url = agentUrl.trim();
    }

    return {
      name: agentName.trim() || `${agentType} connection`,
      type: agentType,
      config,
    };
  }

  async function submit() {
    await onsave(buildPayload());
  }
</script>

<div class="form">
  <div class="field">
    <label for="ct-type">Type</label>
    <select id="ct-type" bind:value={agentType} disabled={isEdit}>
      <option value="claude">Claude (Anthropic API)</option>
      <option value="claude-code">Claude Code (local session)</option>
      <option value="openclaw">OpenClaw (local agent)</option>
      <option value="http">HTTP endpoint</option>
    </select>
    {#if isEdit}
      <span class="field-help">Type is immutable. Delete and recreate to change it.</span>
    {/if}
  </div>

  <div class="field">
    <label for="ct-name">Name</label>
    <input
      id="ct-name"
      type="text"
      bind:value={agentName}
      placeholder={agentType === "claude" ? "Claude" : agentType === "openclaw" ? "My OpenClaw" : agentType === "claude-code" ? "Claude Code" : "Custom endpoint"}
    >
  </div>

  {#if agentType === "claude"}
    <div class="field">
      <label for="ct-model">Model</label>
      <select id="ct-model" bind:value={agentModel}>
        {#each CLAUDE_MODELS as m}
          <option value={m.id}>{m.label}</option>
        {/each}
      </select>
    </div>
    <div class="field">
      <label for="ct-sys">System prompt (optional)</label>
      <textarea
        id="ct-sys"
        bind:value={agentSystemPrompt}
        rows={3}
        placeholder="You are a helpful assistant..."
      ></textarea>
    </div>
  {:else if agentType === "claude-code"}
    <div class="field">
      <label for="ct-cwd">Working directory</label>
      <input
        id="ct-cwd"
        type="text"
        bind:value={agentCwd}
        placeholder="/Users/you/projects/my-repo (leave blank for isolated scratch dir)"
      >
      <span class="field-help">
        Where Claude Code operates — same as running <code>claude</code> after <code>cd</code>'ing there.
      </span>
    </div>
    <div class="field">
      <label for="ct-extras">Additional readable paths (optional)</label>
      <textarea
        id="ct-extras"
        bind:value={agentAdditionalDirs}
        rows={2}
        placeholder="/absolute/path/one&#10;/absolute/path/two"
      ></textarea>
      <span class="field-help">One absolute path per line.</span>
    </div>
    <div class="field">
      <label for="ct-sys">System prompt override (advanced)</label>
      <textarea
        id="ct-sys"
        bind:value={agentSystemPrompt}
        rows={3}
        placeholder="Leave blank to use Claude Code's built-in system prompt (recommended)."
      ></textarea>
    </div>
  {:else if agentType === "openclaw"}
    <div class="field">
      <label for="ct-url">Gateway URL</label>
      <input
        id="ct-url"
        type="text"
        bind:value={agentUrl}
        placeholder="ws://127.0.0.1:18789"
      >
      <span class="field-help">
        The OpenClaw gateway WebSocket URL. For a local gateway, leave as default.
      </span>
    </div>
    <div class="field">
      <label for="ct-device-name">Device name</label>
      <input
        id="ct-device-name"
        type="text"
        bind:value={agentDeviceName}
        placeholder="langouste"
      >
      <span class="field-help">
        Shown in <code>openclaw devices list</code> so you can identify this connector.
      </span>
    </div>
    <div class="field">
      <label for="ct-token">Gateway token (optional)</label>
      <input
        id="ct-token"
        type="text"
        bind:value={agentToken}
        placeholder="from ~/.openclaw/openclaw.json gateway.auth.token"
      >
      <span class="field-help">
        Required if the gateway runs in <code>auth.mode=token</code>. For a loopback
        gateway started with <code>--auth none</code>, leave blank.
      </span>
    </div>
    <div class="field">
      <label for="ct-bootstrap">Bootstrap token (one-time)</label>
      <input
        id="ct-bootstrap"
        type="text"
        bind:value={agentBootstrapToken}
        placeholder="only for non-loopback gateways"
      >
      <span class="field-help">
        Loopback connections auto-pair silently. For a remote gateway, generate a
        bootstrap token via the OpenClaw CLI and paste it here; it's consumed on first
        connect and replaced with a persistent device token.
      </span>
    </div>
  {:else if agentType === "http"}
    <div class="field">
      <label for="ct-url">Endpoint URL</label>
      <input
        id="ct-url"
        type="text"
        bind:value={agentUrl}
        placeholder="https://api.example.com/chat"
      >
    </div>
  {/if}

  <div class="actions">
    <button class="btn-secondary" onclick={oncancel} disabled={saving}>Cancel</button>
    <button class="btn-primary" onclick={submit} disabled={saving}>
      {saving ? "Saving…" : saveLabel}
    </button>
  </div>
</div>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .field label {
    display: block;
    font-size: 0.8rem;
    font-weight: 500;
    color: var(--color-text-light);
    margin-bottom: 0.2rem;
  }

  .field input, .field select, .field textarea {
    width: 100%;
    padding: 0.5rem 0.6rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    font-size: 0.9rem;
  }

  .field textarea {
    resize: vertical;
  }

  .field-help {
    display: block;
    font-size: 0.7rem;
    color: var(--color-text-light);
    margin-top: 0.2rem;
    line-height: 1.4;
  }

  .field-help code {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    background: var(--color-bg);
    padding: 0 0.2rem;
    border-radius: 2px;
  }

  .actions {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
    margin-top: 0.25rem;
  }

  .btn-primary {
    padding: 0.5rem 1rem;
    background: var(--color-primary);
    color: white;
    border: none;
    border-radius: var(--radius-sm);
    font-weight: 600;
    font-size: 0.9rem;
    cursor: pointer;
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .btn-secondary {
    padding: 0.5rem 1rem;
    background: none;
    color: var(--color-text-light);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    font-size: 0.9rem;
    cursor: pointer;
  }
</style>
