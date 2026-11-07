export type AssistantMode = "mock" | "openai";

export interface ToolInfo {
  name: string;
  description: string;
}

export type ServerEvent =
  | { type: "meta"; conversationId: string; mode: AssistantMode }
  | { type: "text"; delta: string }
  | { type: "tool_call"; id: string; name: string; arguments: unknown }
  | { type: "tool_result"; id: string; name: string; ok: boolean; result: unknown }
  | { type: "done"; finishReason: string }
  | { type: "error"; message: string };

export interface PublicToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export type PublicMessage =
  | { role: "user" | "assistant"; content: string; toolCalls?: PublicToolCall[] }
  | { role: "tool"; content: string; toolCallId: string; name: string };

export type TranscriptItem =
  | { kind: "user"; id: string; content: string }
  | { kind: "assistant"; id: string; content: string; pending: boolean }
  | {
      kind: "tool";
      id: string;
      name: string;
      arguments: unknown;
      status: "running" | "done" | "error";
      result?: unknown;
    }
  | { kind: "error"; id: string; message: string };
