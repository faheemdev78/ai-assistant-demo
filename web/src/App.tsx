import { useEffect, useId, useRef, useState } from "react";
import { getConversation, getHealth, getTools, streamChat } from "./api";
import type {
  AssistantMode,
  PublicMessage,
  ServerEvent,
  ToolInfo,
  TranscriptItem,
} from "./types";

const STORAGE_KEY = "assistant.conversationId";

const SUGGESTIONS = [
  "What's the weather in Lisbon?",
  "Calculate (18 * 4) / 3",
  "Save a note: ship the demo",
  "Search for server-sent events",
];

export function App() {
  const [mode, setMode] = useState<AssistantMode | "offline">("mock");
  const [model, setModel] = useState("mock");
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [turns, setTurns] = useState<TranscriptItem[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [booting, setBooting] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputId = useId();

  useEffect(() => {
    const stored = sessionStorage.getItem(STORAGE_KEY) ?? undefined;
    let cancelled = false;

    async function boot() {
      try {
        const [health, catalog] = await Promise.all([getHealth(), getTools()]);
        if (cancelled) return;
        setMode(health.mode);
        setModel(health.model);
        setTools(catalog);
        if (stored) {
          const messages = await getConversation(stored);
          if (cancelled) return;
          if (messages.length > 0) {
            setConversationId(stored);
            setTurns(messagesToTurns(messages));
          } else {
            sessionStorage.removeItem(STORAGE_KEY);
          }
        }
      } catch {
        if (!cancelled) setMode("offline");
      } finally {
        if (!cancelled) setBooting(false);
      }
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns, busy]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  function resetChat() {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setTurns([]);
    setConversationId(undefined);
    sessionStorage.removeItem(STORAGE_KEY);
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setDraft("");
    setBusy(true);
    setTurns((current) => [
      ...current,
      { kind: "user", id: crypto.randomUUID(), content: message },
    ]);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamChat(
        conversationId ? { conversationId, message } : { message },
        (event) => applyEvent(event, setTurns, setConversationId, setMode),
        controller.signal,
      );
    } catch (error) {
      if (controller.signal.aborted) return;
      const detail = error instanceof Error ? error.message : "The request failed";
      setTurns((current) => [
        ...settle(current),
        { kind: "error", id: crypto.randomUUID(), message: detail },
      ]);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setBusy(false);
    }
  }

  function stop() {
    abortRef.current?.abort();
    setBusy(false);
    setTurns((current) => settle(current));
  }

  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <span className="mark" aria-hidden="true" />
          <div>
            <p className="brand-name">Assistant</p>
            <p className="brand-sub">tool-using demo</p>
          </div>
        </div>
        <button type="button" className="new-chat" onClick={resetChat}>
          New chat
        </button>
        <p className={`mode mode-${mode}`}>
          {mode === "offline"
            ? "API unreachable"
            : mode === "openai"
              ? `Live · ${model}`
              : "Mock mode · no API key"}
        </p>
        <h2>Tools</h2>
        <ul className="tool-list">
          {tools.map((tool) => (
            <li key={tool.name}>
              <code>{tool.name}</code>
              <span>{tool.description}</span>
            </li>
          ))}
          {tools.length === 0 && !booting && <li className="muted">Tools unavailable</li>}
        </ul>
      </aside>
      <main>
        <header className="top">
          <div>
            <p className="eyebrow">Conversation</p>
            <h1>{conversationId ? "In memory on this server" : "Start a thread"}</h1>
          </div>
        </header>
        <div className="transcript" aria-live="polite">
          {turns.length === 0 && (
            <div className="empty">
              <h2>Ask for weather, math, notes, or a search.</h2>
              <p>
                Tokens stream in as they arrive. Tool calls render beside the reply,
                including arguments and results.
              </p>
              <div className="suggestions">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => void send(suggestion)}
                    disabled={busy || mode === "offline"}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}
          {turns.map((turn) => {
            if (turn.kind === "user") {
              return (
                <article key={turn.id} className="bubble user">
                  {turn.content}
                </article>
              );
            }
            if (turn.kind === "assistant") {
              return (
                <article key={turn.id} className="bubble assistant">
                  {turn.content}
                  {turn.pending && <span className="caret" aria-hidden="true" />}
                </article>
              );
            }
            if (turn.kind === "error") {
              return (
                <p key={turn.id} className="error" role="alert">
                  {turn.message}
                </p>
              );
            }
            return <ToolCard key={turn.id} turn={turn} />;
          })}
          <div ref={endRef} />
        </div>
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            void send(draft);
          }}
        >
          <label htmlFor={inputId}>Message</label>
          <textarea
            id={inputId}
            value={draft}
            rows={2}
            placeholder="Ask something"
            disabled={mode === "offline"}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send(draft);
              }
            }}
          />
          {busy ? (
            <button type="button" className="send stop" onClick={stop}>
              Stop
            </button>
          ) : (
            <button
              type="submit"
              className="send"
              disabled={!draft.trim() || mode === "offline"}
            >
              Send
            </button>
          )}
        </form>
      </main>
    </div>
  );
}

function ToolCard({ turn }: { turn: Extract<TranscriptItem, { kind: "tool" }> }) {
  return (
    <article className={`tool-card status-${turn.status}`}>
      <header>
        <code>{turn.name}</code>
        <span>{turn.status}</span>
      </header>
      <pre>
        {JSON.stringify({ arguments: turn.arguments, result: turn.result }, null, 2)}
      </pre>
    </article>
  );
}

function applyEvent(
  event: ServerEvent,
  setTurns: (update: (current: TranscriptItem[]) => TranscriptItem[]) => void,
  setConversationId: (id: string) => void,
  setMode: (mode: AssistantMode) => void,
) {
  if (event.type === "meta") {
    setConversationId(event.conversationId);
    sessionStorage.setItem(STORAGE_KEY, event.conversationId);
    setMode(event.mode);
    return;
  }
  if (event.type === "text") {
    setTurns((current) => appendText(current, event.delta));
    return;
  }
  if (event.type === "tool_call") {
    setTurns((current) => [
      ...settle(current),
      {
        kind: "tool",
        id: event.id,
        name: event.name,
        arguments: event.arguments,
        status: "running",
      },
    ]);
    return;
  }
  if (event.type === "tool_result") {
    setTurns((current) =>
      current.map((turn) =>
        turn.kind === "tool" && turn.id === event.id
          ? {
              ...turn,
              status: event.ok ? "done" : "error",
              result: event.result,
            }
          : turn,
      ),
    );
    return;
  }
  if (event.type === "done") {
    setTurns((current) => settle(current));
    return;
  }
  setTurns((current) => [
    ...settle(current),
    { kind: "error", id: crypto.randomUUID(), message: event.message },
  ]);
}

function appendText(turns: TranscriptItem[], delta: string): TranscriptItem[] {
  const last = turns[turns.length - 1];
  if (last?.kind === "assistant" && last.pending) {
    return [...turns.slice(0, -1), { ...last, content: last.content + delta }];
  }
  return [
    ...turns,
    { kind: "assistant", id: crypto.randomUUID(), content: delta, pending: true },
  ];
}

function settle(turns: TranscriptItem[]): TranscriptItem[] {
  return turns.map((turn) =>
    turn.kind === "assistant" && turn.pending ? { ...turn, pending: false } : turn,
  );
}

function messagesToTurns(messages: PublicMessage[]): TranscriptItem[] {
  const turns: TranscriptItem[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      turns.push({ kind: "user", id: crypto.randomUUID(), content: message.content });
      continue;
    }
    if (message.role === "assistant") {
      if (message.content) {
        turns.push({
          kind: "assistant",
          id: crypto.randomUUID(),
          content: message.content,
          pending: false,
        });
      }
      for (const call of message.toolCalls ?? []) {
        turns.push({
          kind: "tool",
          id: call.id,
          name: call.name,
          arguments: call.arguments,
          status: "running",
        });
      }
      continue;
    }
    if (message.role !== "tool") continue;
    const payload = readToolContent(message.content);
    const index = turns.findIndex(
      (turn) => turn.kind === "tool" && turn.id === message.toolCallId,
    );
    const existing = index >= 0 ? turns[index] : undefined;
    if (existing?.kind === "tool") {
      turns[index] = {
        ...existing,
        status: payload.ok ? "done" : "error",
        result: payload.result,
      };
    }
  }
  return turns;
}

function readToolContent(content: string): { ok: boolean; result: unknown } {
  try {
    const parsed = JSON.parse(content) as {
      ok?: boolean;
      data?: unknown;
      error?: string;
    };
    if (parsed.ok) return { ok: true, result: parsed.data };
    return { ok: false, result: { error: parsed.error ?? "Tool failed" } };
  } catch {
    return { ok: false, result: { error: content } };
  }
}
