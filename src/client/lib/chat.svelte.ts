/**
 * The Chat model — one instance per conversation_id, the single owner of
 * everything that belongs to a conversation:
 *
 *   - the Conversation record (members, agent connector, unread count)
 *   - its messages
 *   - the unsent draft (text / intent / language) — kept 100% of the time
 *   - the review pipeline state (phase + errors + explanations + correction)
 *   - whether the chat is "working" (review or agent in flight)
 *   - its realtime subscription
 *
 * State physically cannot leak between conversations: each Chat has its own
 * fields, and the two views (sidebar row + main thread) are *pure
 * renderers* of the Chat for a given id. Switching conversations only
 * changes which Chat the views point at — nothing is captured, restored,
 * or aborted. A Chat keeps reviewing / awaiting its agent in the
 * background after you navigate away; coming back just renders its state.
 *
 * Svelte 5: this file is `.svelte.ts` so `$state` works. Each Chat's
 * public fields are reactive; components read them directly.
 */

import { SvelteMap } from "svelte/reactivity";
import { api } from "./api";
import { subscribeToMessages } from "./supabase";
import type { Conversation, Message, ConversationMember } from "./stores.svelte";

export interface TextError {
  start: number;
  end: number;
  text: string;
  kind: "spelling" | "grammar";
  suggestions?: string[];
}

export interface ErrorExplanation {
  error: TextError;
  corrected: string;
  explanations: Record<string, string>;
  rule?: string;
}

export type AdditionalError = TextError & {
  corrected: string;
  explanations: Record<string, string>;
  rule?: string;
};

export interface SelfCorrectedSpan {
  original: string;
  corrected: string;
  kind: "spelling" | "grammar";
  category?: string;
  explanation?: string;
}

/** idle: nothing pending. checking: pipeline in flight. reviewing: results
 *  shown, user is fixing. The agent phase is tracked by `working`. */
export type ReviewPhase = "idle" | "checking" | "reviewing";

export interface Review {
  phase: ReviewPhase;
  /** Raw spell-check errors. */
  errors: TextError[];
  /** Opus explanations for the spell-check errors. */
  explanations: ErrorExplanation[];
  /** Extra grammar errors Opus found beyond spell-check. */
  additionalErrors: AdditionalError[];
  /** Opus's fully-corrected message (if any). */
  correctedMessage: string;
}

function emptyReview(): Review {
  return {
    phase: "idle",
    errors: [],
    explanations: [],
    additionalErrors: [],
    correctedMessage: "",
  };
}

function firstExplanation(explanations: Record<string, string>): string | undefined {
  return Object.values(explanations).find((value) => value.trim().length > 0);
}

export class Chat {
  readonly id: string;

  /** The Conversation record. Replaced wholesale on refresh. */
  conversation = $state<Conversation>(null as unknown as Conversation);

  /** All messages, oldest→newest. */
  messages = $state<Message[]>([]);

  /** The unsent draft. Preserved for the lifetime of the Chat. */
  draft = $state<{ text: string; intent: string; lang: string }>({
    text: "",
    intent: "",
    lang: "",
  });

  /** Review pipeline state for the current draft. */
  review = $state<Review>(emptyReview());

  /** True while the review pipeline OR the agent send is in flight. Drives
   *  the sidebar "working…" indicator. */
  working = $state(false);

  /** Last agent error for this chat (banner in the thread). */
  agentError = $state<string | null>(null);

  /** Unread agent messages. Server seeds it; realtime + open bump/clear. */
  unread = $state(0);

  // --- private ---
  #messagesLoaded = false;
  #unsub: (() => void) | null = null;
  #pendingSelfCorrections: SelfCorrectedSpan[] = [];
  // Monotonic token: bumping it invalidates any in-flight pipeline so a
  // stale response can never write into this chat. Cancel/resend bumps it.
  #reviewToken = 0;

  constructor(conversation: Conversation) {
    this.id = conversation.conversation_id;
    this.conversation = conversation;
    this.unread = conversation.unread_count ?? 0;
    this.draft.lang = this.#defaultLang();
  }

  /** Refresh the underlying Conversation record (members, connector…). */
  setConversation(c: Conversation) {
    this.conversation = c;
    if (!this.draft.lang) this.draft.lang = this.#defaultLang();
  }

  get member(): ConversationMember | undefined {
    return this.conversation?.members?.[0];
  }

  #defaultLang(): string {
    return this.conversation?.members?.[0]?.target_languages?.[0]?.lang ?? "";
  }

  // --- messages ---------------------------------------------------------

  /** Fetch messages once (cached on the instance) + start realtime. */
  async load(): Promise<void> {
    this.ensureRealtime();
    if (this.#messagesLoaded && !this.#hasUnfinishedAgentMessage()) return;
    try {
      const loaded = (await api.getMessages(this.id)) as Message[];
      // Don't clobber optimistic/pending messages added meanwhile.
      const pending = this.messages.filter((m) => m._pending);
      const byId = new Set(loaded.map((m) => m.message_id));
      this.messages = [...loaded, ...pending.filter((p) => !byId.has(p.message_id))];
      this.#messagesLoaded = true;
      this.#ensureTranslations();
    } catch (err) {
      console.error(`[Chat ${this.id.slice(0, 8)}] load failed:`, err);
    }
  }

  #hasUnfinishedAgentMessage(): boolean {
    return this.messages.some((message) => !!message.is_agent && !message.healed_text?.trim());
  }

  /**
   * The viewer's languages (target + base). MessageBubble renders the
   * target-language translation; agent replies arrive English-only, so
   * those translations must be filled in or the bubble stays in its
   * loading skeleton forever (regression fix — this used to live in
   * ChatThread.fillMissingTranslations before the Chat-model rewrite).
   */
  #viewerLangs(): string[] {
    const m = this.member;
    if (!m) return [];
    return [
      ...new Set([...m.target_languages.map((t) => t.lang), ...m.base_languages].filter(Boolean)),
    ];
  }

  #translating = false;
  #translationQueued = false;

  /** If any non-pending message is missing a viewer-language translation,
   *  fetch translations and merge them in. Idempotent + self-throttling. */
  async #ensureTranslations(): Promise<void> {
    if (this.#translating) {
      this.#translationQueued = true;
      return;
    }
    const langs = this.#viewerLangs();
    if (langs.length === 0) return;

    this.#translating = true;
    try {
      do {
        this.#translationQueued = false;
        const needs = this.messages.some(
          (msg) => !msg._pending && langs.some((l) => !msg.translations?.[l]),
        );
        if (!needs) continue;

        const translated = (await api.translateMessages(this.id, langs)) as Message[];
        const byId = new Map(translated.map((m) => [m.message_id, m]));
        // Merge: keep pending placeholders, swap in translated versions of
        // anything the server returned, leave the rest untouched.
        this.messages = this.messages.map((m) => (m._pending ? m : (byId.get(m.message_id) ?? m)));
      } while (this.#translationQueued);
    } catch (err) {
      console.error(`[Chat ${this.id.slice(0, 8)}] translate fill failed:`, err);
    } finally {
      this.#translating = false;
      if (this.#translationQueued) void this.#ensureTranslations();
    }
  }

  /** Subscribe to realtime message inserts/updates for this conversation. */
  ensureRealtime(): void {
    if (this.#unsub) return;
    this.#unsub = subscribeToMessages(this.id, (raw) => {
      const msg = raw as unknown as Message;
      this.#ingestMessage(msg);
    });
  }

  #ingestMessage(msg: Message): void {
    const existingIdx = this.messages.findIndex((m) => m.message_id === msg.message_id);
    if (existingIdx !== -1) {
      const next = this.messages.slice();
      next[existingIdx] = { ...next[existingIdx], ...msg };
      this.messages = next;
      this.#ensureTranslations();
      return;
    }
    // Replace the matching optimistic placeholder rather than duplicating:
    // agent reply → the pending agent bubble; user echo → pending user msg.
    const pendingIdx = this.messages.findIndex(
      (m) => m._pending && (msg.is_agent ? !!m.is_agent : m.sender_id === msg.sender_id),
    );
    if (pendingIdx !== -1) {
      const next = this.messages.slice();
      next[pendingIdx] = msg;
      this.messages = next;
    } else {
      this.messages = [...this.messages, msg];
    }
    // Agent replies arrive English-only — fill the viewer's translation
    // so the bubble doesn't sit in its loading skeleton.
    this.#ensureTranslations();
  }

  dispose(): void {
    this.#unsub?.();
    this.#unsub = null;
  }

  // --- draft ------------------------------------------------------------

  setDraftText(text: string): void {
    this.draft = { ...this.draft, text };
  }
  setDraftIntent(intent: string): void {
    this.draft = { ...this.draft, intent };
  }
  setDraftLang(lang: string): void {
    this.draft = { ...this.draft, lang };
  }

  #clearDraft(): void {
    this.draft = { text: "", intent: "", lang: this.#defaultLang() };
    this.review = emptyReview();
    this.#pendingSelfCorrections = [];
  }

  // --- review pipeline --------------------------------------------------

  /** Cancel any in-flight review for this chat and reset to idle. */
  cancelReview(): void {
    this.#reviewToken++;
    this.review = { ...emptyReview() };
    this.#pendingSelfCorrections = [];
    this.working = false;
  }

  /**
   * Run the spell-check → Opus-explain pipeline against the current draft.
   * Pinned to a review token so a stale response (or one after
   * cancel/resend) is discarded. Auto-sends when the message is clean.
   * Keeps running if the user navigates away — results land on THIS chat.
   */
  async runReview(): Promise<void> {
    const text = this.draft.text.trim();
    if (!text) return;

    const token = ++this.#reviewToken;
    const intent = this.draft.intent.trim();
    let lang = this.draft.lang;
    const stale = () => token !== this.#reviewToken;
    this.#mergeSelfCorrections(this.#collectSelfCorrections(text));

    this.review = { ...emptyReview(), phase: "checking" };
    this.working = true;

    try {
      const result = (await api.checkMessage(this.id, text, lang)) as {
        clean: boolean;
        language: string;
        errors: TextError[];
      };
      if (stale()) return;
      lang = result.language;
      if (lang && lang !== this.draft.lang) this.setDraftLang(lang);

      this.review = {
        ...this.review,
        errors: [...result.errors],
        phase: result.errors.length > 0 ? "reviewing" : this.review.phase,
      };

      let explainResult: {
        corrected_message?: string;
        explanations?: ErrorExplanation[];
        additional_errors?: AdditionalError[];
      };
      try {
        explainResult = (await api.explainErrors(this.id, {
          text,
          errors: result.errors,
          language: lang,
          intent: intent || undefined,
        })) as typeof explainResult;
      } catch (err: unknown) {
        if (stale() || (err as Error)?.name === "AbortError") return;
        console.error(`[Chat ${this.id.slice(0, 8)}] explain failed:`, err);
        // Explanation failed: if spelling was clean, just send it.
        if (result.clean) {
          this.#send(text, lang, intent, this.#pendingSelfCorrections);
        } else {
          this.review = { ...this.review, phase: "reviewing" };
          this.working = false;
        }
        return;
      }
      if (stale()) return;

      const corrected = explainResult.corrected_message ?? "";
      const explanations = explainResult.explanations ?? [];
      const additionalErrors = explainResult.additional_errors ?? [];

      // Nothing to fix → send.
      if (
        explanations.length === 0 &&
        additionalErrors.length === 0 &&
        (!corrected || corrected.trim() === text)
      ) {
        this.#send(text, lang, intent, this.#pendingSelfCorrections);
        return;
      }

      this.review = {
        phase: "reviewing",
        errors: this.review.errors,
        explanations: [...explanations],
        additionalErrors: [...additionalErrors],
        correctedMessage: corrected,
      };
      // Review done; agent phase hasn't started. Stop the indicator.
      this.working = false;
    } catch (err: unknown) {
      if (stale() || (err as Error)?.name === "AbortError") return;
      console.error(`[Chat ${this.id.slice(0, 8)}] check failed:`, err);
      // Spell-check itself failed — fall back to sending verbatim.
      this.#send(text, lang, intent, this.#pendingSelfCorrections);
    }
  }

  // --- sending ----------------------------------------------------------

  /** Force-send the current draft verbatim (Shift+Enter / matches fix). */
  sendNow(): void {
    const text = this.draft.text.trim();
    if (!text) return;
    const selfCorrections = this.#mergeSelfCorrections(this.#collectSelfCorrections(text));
    this.cancelReview();
    this.#send(text, this.draft.lang, this.draft.intent.trim(), selfCorrections);
  }

  /** Internal: perform the send. Both the user's message AND a pending
   *  agent-reply bubble appear immediately (optimistic), before the
   *  blocking agent round-trip — so the UI responds the instant the user
   *  commits to sending. Everything here is scoped to THIS chat. */
  async #send(
    text: string,
    lang: string,
    intent: string,
    selfCorrectedSpans: SelfCorrectedSpan[] = [],
  ): Promise<void> {
    this.#clearDraft();
    this.agentError = null;
    this.working = true;

    const stamp = Date.now();
    const userPendingId = `pending-user-${stamp}`;
    const agentPendingId = `pending-agent-${stamp}`;

    const userPending: Message = {
      message_id: userPendingId,
      conversation_id: this.id,
      sender_id: this.member?.user_id ?? "me",
      raw_text: text,
      healed_text: text,
      language: lang,
      translation: null,
      translations: {},
      corrections: [],
      next_challenge: null,
      created_at: new Date().toISOString(),
      _pending: true,
    };
    // Pending agent bubble — shows the "…" placeholder immediately while
    // the agent thinks. Replaced (or removed) when the reply resolves.
    const agentPending: Message = {
      message_id: agentPendingId,
      conversation_id: this.id,
      sender_id: "agent",
      raw_text: "",
      healed_text: "",
      language: lang,
      translation: null,
      translations: {},
      corrections: [],
      next_challenge: null,
      is_agent: true,
      created_at: new Date(stamp + 1).toISOString(),
      _pending: true,
    };
    this.messages = [...this.messages, userPending, agentPending];

    const resolveAgent = (msg: Message | null) => {
      this.messages = msg
        ? this.messages.map((m) => (m.message_id === agentPendingId ? msg : m))
        : this.messages.filter((m) => m.message_id !== agentPendingId);
    };

    try {
      const result = (await api.sendMessage(
        this.id,
        text,
        lang,
        intent || undefined,
        selfCorrectedSpans,
      )) as {
        message: Message;
        agent_message?: Message;
        agent_error?: string;
      };
      // Swap the optimistic user message for the stored one.
      this.messages = this.messages.map((m) =>
        m.message_id === userPendingId ? result.message : m,
      );
      if (result.agent_message) {
        // Realtime may already have ingested it — dedupe, then drop the
        // placeholder.
        if (this.messages.some((m) => m.message_id === result.agent_message!.message_id)) {
          resolveAgent(null);
        } else {
          resolveAgent(result.agent_message);
        }
      } else {
        resolveAgent(null);
        if (result.agent_error) this.agentError = result.agent_error;
      }
    } catch (err) {
      console.error(`[Chat ${this.id.slice(0, 8)}] send failed:`, err);
      this.messages = this.messages.filter(
        (m) => m.message_id !== userPendingId && m.message_id !== agentPendingId,
      );
    } finally {
      this.working = false;
      // Agent reply + the user's stored message arrive English/source-only;
      // fill the viewer-language translations so bubbles don't get stuck
      // in the loading skeleton.
      this.#ensureTranslations();
    }
  }

  #collectSelfCorrections(currentText: string): SelfCorrectedSpan[] {
    const currentLower = currentText.toLowerCase();
    const target = this.review.correctedMessage.trim().toLowerCase();
    const fullyMatched =
      !!target && currentLower.trim().replace(/\s+/g, " ") === target.replace(/\s+/g, " ");
    const spans: SelfCorrectedSpan[] = [];

    const push = (
      error: TextError,
      corrected: string,
      explanations: Record<string, string>,
      rule?: string,
    ) => {
      if (!corrected || corrected.trim().toLowerCase() === error.text.trim().toLowerCase()) return;
      const originalLower = error.text.toLowerCase();
      const correctedLower = corrected.toLowerCase();
      const resolved =
        fullyMatched ||
        (!currentLower.includes(originalLower) && currentLower.includes(correctedLower));
      if (!resolved) return;
      spans.push({
        original: error.text,
        corrected,
        kind: error.kind,
        category: rule,
        explanation: firstExplanation(explanations),
      });
    };

    for (const explanation of this.review.explanations) {
      push(explanation.error, explanation.corrected, explanation.explanations, explanation.rule);
    }
    for (const error of this.review.additionalErrors) {
      push(
        { start: error.start, end: error.end, text: error.text, kind: error.kind },
        error.corrected,
        error.explanations,
        error.rule,
      );
    }
    return spans;
  }

  #mergeSelfCorrections(spans: SelfCorrectedSpan[]): SelfCorrectedSpan[] {
    if (spans.length === 0) return this.#pendingSelfCorrections;
    const byKey = new Map<string, SelfCorrectedSpan>();
    for (const span of [...this.#pendingSelfCorrections, ...spans]) {
      byKey.set(`${span.kind}:${span.original.toLowerCase()}=>${span.corrected.toLowerCase()}`, span);
    }
    this.#pendingSelfCorrections = [...byKey.values()];
    return this.#pendingSelfCorrections;
  }

  // --- unread -----------------------------------------------------------

  bumpUnread(): void {
    this.unread += 1;
  }

  async markRead(): Promise<void> {
    if (this.unread === 0) return;
    this.unread = 0;
    try {
      await api.markConversationRead(this.id);
    } catch (err) {
      console.error(`[Chat ${this.id.slice(0, 8)}] markRead failed:`, err);
    }
  }
}

/**
 * The single registry of Chat instances. Lazily creates one Chat per
 * conversation_id; everything else (sidebar, thread, input) reads from
 * here. There is exactly one Chat per conversation for the whole session.
 */
class ChatStore {
  // Reactive map: getters that read it (active/list/get) are tracked, so a
  // mutation to any Chat — or to the membership — propagates to the views.
  #chats = new SvelteMap<string, Chat>();
  /** Ordered conversation list for the sidebar (newest first from server). */
  order = $state<string[]>([]);
  /** The conversation currently shown in the main view. */
  activeId = $state<string | null>(null);

  /** Get (or lazily create) the Chat for a Conversation record. */
  upsert(conversation: Conversation): Chat {
    const id = conversation.conversation_id;
    const existing = this.#chats.get(id);
    if (existing) {
      existing.setConversation(conversation);
      return existing;
    }
    const chat = new Chat(conversation);
    this.#chats.set(id, chat);
    return chat;
  }

  get(id: string): Chat | undefined {
    return this.#chats.get(id);
  }

  get active(): Chat | null {
    return this.activeId ? (this.#chats.get(this.activeId) ?? null) : null;
  }

  get list(): Chat[] {
    return this.order.map((id) => this.#chats.get(id)).filter((c): c is Chat => !!c);
  }

  /** Replace the conversation list (e.g. after api.getConversations()). */
  setConversations(convs: Conversation[]): void {
    for (const c of convs) this.upsert(c);
    this.order = convs.map((c) => c.conversation_id);
  }

  setActive(id: string | null): void {
    this.activeId = id;
    if (id) this.#chats.get(id)?.load();
  }

  totalUnread(): number {
    return this.list.reduce((n, c) => n + c.unread, 0);
  }
}

export const chatStore = new ChatStore();
