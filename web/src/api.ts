import type { AssistantMode, PublicMessage, ServerEvent, ToolInfo } from "./types";

export async function getHealth(): Promise<{ mode: AssistantMode; model: string }> {
  const response = await fetch("/api/health");
  if (!response.ok) throw new Error("Health check failed");
  return (await response.json()) as { mode: AssistantMode; model: string };
}

export async function getTools(): Promise<ToolInfo[]> {
  const response = await fetch("/api/tools");
  if (!response.ok) throw new Error("Could not load tools");
  const body = (await response.json()) as { tools: ToolInfo[] };
  return body.tools;
}

export async function getConversation(id: string): Promise<PublicMessage[]> {
  const response = await fetch(`/api/conversations/${encodeURIComponent(id)}`);
  if (response.status === 404) return [];
  if (!response.ok) throw new Error("Could not load the conversation");
  const body = (await response.json()) as { messages: PublicMessage[] };
  return body.messages;
}

export async function streamChat(
  input: { conversationId?: string; message: string },
  onEvent: (event: ServerEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(input),
    signal,
  });

  if (!response.ok || !response.body) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // The body was not JSON.
    }
    throw new Error(message);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const event = parseFrame(frame);
      if (event) onEvent(event);
    }
  }
}

function parseFrame(frame: string): ServerEvent | null {
  let eventName = "message";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) eventName = line.slice("event:".length).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trim());
  }
  if (dataLines.length === 0) return null;
  const data = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
  switch (eventName) {
    case "meta":
      return {
        type: "meta",
        conversationId: String(data.conversationId ?? ""),
        mode: data.mode === "openai" ? "openai" : "mock",
      };
    case "text":
      return { type: "text", delta: String(data.delta ?? "") };
    case "tool_call":
      return {
        type: "tool_call",
        id: String(data.id ?? ""),
        name: String(data.name ?? ""),
        arguments: data.arguments,
      };
    case "tool_result":
      return {
        type: "tool_result",
        id: String(data.id ?? ""),
        name: String(data.name ?? ""),
        ok: data.ok === true,
        result: data.result,
      };
    case "done":
      return { type: "done", finishReason: String(data.finishReason ?? "stop") };
    case "error":
      return { type: "error", message: String(data.message ?? "Something went wrong") };
    default:
      return null;
  }
}
