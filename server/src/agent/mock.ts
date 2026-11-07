import type { AnyTool } from "../tools/define.js";
import type { ChatMessage, ModelEvent } from "../types.js";
import type { ChatClient } from "./loop.js";

interface PlannedCall {
  name: string;
  arguments: Record<string, unknown>;
}

export class MockChatClient implements ChatClient {
  private sequence = 0;

  constructor(private readonly delayMs = 16) {}

  async *stream(input: {
    messages: ChatMessage[];
    tools: AnyTool[];
  }): AsyncGenerator<ModelEvent> {
    const results = trailingToolMessages(input.messages);
    if (results.length > 0) {
      yield* this.speak(summarize(results));
      yield { type: "finish", reason: "stop" };
      return;
    }

    const planned = plan(latestUser(input.messages));
    if (planned) {
      this.sequence += 1;
      yield {
        type: "tool_call",
        call: {
          id: `call_mock_${this.sequence}`,
          name: planned.name,
          arguments: JSON.stringify(planned.arguments),
        },
      };
      yield { type: "finish", reason: "tool_calls" };
      return;
    }

    yield* this.speak(directReply());
    yield { type: "finish", reason: "stop" };
  }

  private async *speak(text: string): AsyncGenerator<ModelEvent> {
    const parts = text.split(/(\s+)/).filter((part) => part.length > 0);
    for (const part of parts) {
      if (this.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      }
      yield { type: "text", delta: part };
    }
  }
}

function latestUser(messages: ChatMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") return message.content;
  }
  return "";
}

function trailingToolMessages(messages: ChatMessage[]): ChatMessage[] {
  const found: ChatMessage[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "tool") break;
    found.push(message);
  }
  return found.reverse();
}

export function plan(text: string): PlannedCall | null {
  const note = planNote(text);
  if (note) return { name: "notes", arguments: note };
  if (/\b(weather|forecast|temperature)\b/i.test(text)) {
    return { name: "get_weather", arguments: { location: extractLocation(text) } };
  }
  if (/\b(search|look up|lookup)\b/i.test(text)) {
    return { name: "web_search", arguments: { query: extractQuery(text), limit: 3 } };
  }
  const expression = extractExpression(text);
  if (
    expression &&
    (/[+\-*/()]/.test(expression) || /\b(calculate|compute|what is|what's)\b/i.test(text))
  ) {
    return { name: "calculate", arguments: { expression } };
  }
  return null;
}

function planNote(text: string): Record<string, unknown> | null {
  if (!/\bnotes?\b|\bremember\b/i.test(text)) return null;
  const id = text.match(/\bn_\d+\b/)?.[0];
  if (/\b(delete|remove)\b/i.test(text)) return { action: "delete", id: id ?? "missing" };
  if (/\b(list|show|what are)\b/i.test(text)) return { action: "list" };
  if (id && /\b(update|edit|change)\b/i.test(text)) {
    const body = text.split(":").slice(1).join(":").trim() || "Updated note";
    return { action: "update", id, body };
  }
  if (id && /\b(get|read|open)\b/i.test(text)) return { action: "get", id };
  const titled = text.match(/(?:note|remember)\s*[:-]\s*(.+)$/i);
  const content = (titled?.[1] ?? text).replace(/[?.!]+$/g, "").trim() || "Untitled";
  return { action: "create", title: content.slice(0, 80), body: content };
}

export function extractLocation(text: string): string {
  const match = text.match(/\b(?:in|for|at)\s+([A-Za-z][A-Za-z .'-]{0,80})/i);
  const raw = match?.[1]?.replace(/\b(please|today|now|tomorrow)\b.*$/i, "") ?? "";
  const location = raw.replace(/[?.!,].*$/, "").trim();
  return location || "San Francisco";
}

export function extractQuery(text: string): string {
  const query = text
    .replace(/^.*?\b(?:search|look up|lookup)\b(?:\s+for)?\s*/i, "")
    .replace(/[?.!]+$/g, "")
    .trim();
  return query || text.trim();
}

export function extractExpression(text: string): string | null {
  const start = text.search(/[(.\d]/);
  if (start < 0) return null;
  let index = start;
  const previous = text[index - 1];
  const beforePrevious = text[index - 2];
  if (
    previous === "-" &&
    (beforePrevious === undefined || /[\s(]/.test(beforePrevious) || index === 1)
  ) {
    index -= 1;
  }
  const slice = text.slice(index);
  const end = slice.search(/[^0-9+\-*/().\s]/);
  const expression = (end === -1 ? slice : slice.slice(0, end)).trim();
  if (!/\d/.test(expression)) return null;
  return expression;
}

function directReply(): string {
  return "I'm running in mock mode, so this reply is scripted. Ask for weather, arithmetic, a note, or a search and I'll call the matching tool.";
}

function summarize(messages: ChatMessage[]): string {
  return messages
    .map((message) => summarizeOne(message.name ?? "tool", message.content))
    .join(" ");
}

function summarizeOne(name: string, content: string): string {
  const payload = readPayload(content);
  if (!payload.ok) return `I couldn't complete ${name}: ${payload.error}`;
  const data = payload.data;
  if (name === "get_weather" && isRecord(data)) {
    const unit = data.unit === "fahrenheit" ? "°F" : "°C";
    return `It's ${String(data.temperature)}${unit} and ${String(data.condition).toLowerCase()} in ${String(data.location)}. Humidity is ${String(data.humidity)}%. This reading is mocked.`;
  }
  if (name === "calculate" && isRecord(data)) {
    return `${String(data.expression)} = ${String(data.result)}.`;
  }
  if (name === "web_search" && isRecord(data) && Array.isArray(data.results)) {
    const first = data.results[0];
    const title = isRecord(first) ? String(first.title) : "a stub result";
    return `Stub search for “${String(data.query)}” returned ${data.results.length} results. The first is “${title}”. Nothing here was fetched from the live web.`;
  }
  if (name === "notes" && isRecord(data)) {
    if (Array.isArray(data.notes)) {
      if (data.notes.length === 0) return "You have no notes yet.";
      const labels = data.notes
        .filter(isRecord)
        .map((note) => `${String(note.id)} ${String(note.title)}`)
        .join(", ");
      return `You have ${data.notes.length} note${data.notes.length === 1 ? "" : "s"}: ${labels}.`;
    }
    if (data.deleted === true) return `Deleted ${String(data.id)}.`;
    if (typeof data.id === "string" && typeof data.title === "string") {
      return `Saved “${data.title}” as ${data.id}. ${typeof data.body === "string" ? data.body : ""}`.trim();
    }
  }
  return `${name} finished.`;
}

function readPayload(
  content: string,
): { ok: true; data: unknown } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (isRecord(parsed) && parsed.ok === true) return { ok: true, data: parsed.data };
    if (isRecord(parsed) && parsed.ok === false) {
      return {
        ok: false,
        error: typeof parsed.error === "string" ? parsed.error : "Tool failed",
      };
    }
  } catch {
    return { ok: false, error: "Tool returned invalid JSON" };
  }
  return { ok: false, error: "Tool returned an unexpected payload" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
