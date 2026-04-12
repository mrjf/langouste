<script lang="ts">
  import { api } from "../lib/api";
  import { saveSession, loadProfile } from "../lib/auth";
  import LanguagePicker from "./LanguagePicker.svelte";

  const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

  let mode: "login" | "signup" = $state("login");
  let error = $state("");

  // Form fields
  let email = $state("");
  let password = $state("");
  let displayName = $state("");
  let nativeLanguage = $state("en");
  let learningLanguage = $state("fr");
  let cefrLevel = $state("A1");

  interface Props {
    onauthenticated?: () => void;
  }

  let { onauthenticated }: Props = $props();

  async function submit(e: Event) {
    e.preventDefault();
    error = "";

    try {
      let result;
      if (mode === "signup") {
        result = await api.signup({
          email,
          password,
          display_name: displayName,
          base_language: nativeLanguage,
          learning_languages: [{
            lang: learningLanguage,
            cefr_level: cefrLevel,
            assessed_at: new Date().toISOString(),
          }],
        });
      } else {
        result = await api.login({ email, password });
      }

      saveSession(result.session, result.user);
      await loadProfile();
      onauthenticated?.();
    } catch (err: any) {
      error = err.message;
    }
  }
</script>

<div class="login-container">
  <h1>Langouste</h1>
  <p class="subtitle">Learn languages through real conversation</p>
  <form onsubmit={submit}>
    {#if mode === "signup"}
      <div class="field">
        <label for="display_name">Display name</label>
        <input id="display_name" type="text" required placeholder="Your name" bind:value={displayName}>
      </div>
    {/if}
    <div class="field">
      <label for="email">Email</label>
      <input id="email" type="email" required placeholder="you@example.com" bind:value={email}>
    </div>
    <div class="field">
      <label for="password">Password</label>
      <input id="password" type="password" required minlength={6} placeholder="At least 6 characters" bind:value={password}>
    </div>
    {#if mode === "signup"}
      <div class="field">
        <label for="native_lang">Base language</label>
        <LanguagePicker name="base_language" bind:value={nativeLanguage} />
      </div>
      <div class="field">
        <label for="learning_lang">Target language</label>
        <LanguagePicker name="learning_language" bind:value={learningLanguage} />
      </div>
      <div class="field">
        <label for="cefr">My level</label>
        <select id="cefr" bind:value={cefrLevel}>
          {#each CEFR_LEVELS as level}
            <option value={level}>{level}</option>
          {/each}
        </select>
      </div>
    {/if}
    <button type="submit" class="btn">{mode === "signup" ? "Sign Up" : "Log In"}</button>
    {#if error}
      <div class="error-msg">{error}</div>
    {/if}
  </form>
  <div class="toggle">
    {#if mode === "signup"}
      Already have an account? <button class="toggle-link" onclick={() => mode = "login"}>Log in</button>
    {:else}
      Need an account? <button class="toggle-link" onclick={() => mode = "signup"}>Sign up</button>
    {/if}
  </div>
</div>

<style>
  :global(body:has(.login-container)) {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .login-container {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    background: var(--color-surface);
    border-radius: var(--radius);
    box-shadow: var(--shadow-lg);
    padding: 2.5rem;
    width: 100%;
    max-width: 400px;
    margin: auto;
  }

  h1 {
    font-size: 1.75rem;
    margin-bottom: 0.25rem;
    color: var(--color-primary);
  }

  .subtitle {
    color: var(--color-text-light);
    margin-bottom: 2rem;
    font-size: 0.9rem;
  }

  .field {
    margin-bottom: 1rem;
  }

  label {
    display: block;
    font-size: 0.85rem;
    font-weight: 500;
    margin-bottom: 0.25rem;
    color: var(--color-text-light);
  }

  input, select, :global(.field select) {
    width: 100%;
    padding: 0.75rem;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    font-size: 1rem;
    outline: none;
    transition: border-color 0.15s;
  }

  input:focus, select:focus {
    border-color: var(--color-primary);
  }

  .btn {
    width: 100%;
    padding: 0.75rem;
    background: var(--color-primary);
    color: white;
    border: none;
    border-radius: var(--radius-sm);
    font-size: 1rem;
    font-weight: 600;
    margin-top: 0.5rem;
  }

  .btn:hover {
    opacity: 0.9;
  }

  .toggle {
    text-align: center;
    margin-top: 1rem;
    font-size: 0.85rem;
    color: var(--color-text-light);
  }

  .toggle-link {
    background: none;
    border: none;
    color: var(--color-primary);
    font-size: 0.85rem;
    text-decoration: none;
    padding: 0;
  }

  .error-msg {
    color: var(--color-error);
    font-size: 0.85rem;
    margin-top: 0.5rem;
  }
</style>
