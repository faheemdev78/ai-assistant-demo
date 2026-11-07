export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
}

export type FinishReason = "stop" | "tool_calls" | "length";

export type ModelEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; call: ToolCall }
  | { type: "finish"; reason: FinishReason };

export type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; id: string; name: string; arguments: unknown }
  | { type: "tool_result"; id: string; name: string; ok: boolean; result: unknown }
  | { type: "done"; finishReason: FinishReason };

export type ToolResult = { ok: true; data: unknown } | { ok: false; error: string };
