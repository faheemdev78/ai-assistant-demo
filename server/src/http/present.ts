import { parseArguments } from "../agent/loop.js";
import type { ChatMessage } from "../types.js";

export interface PublicToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export type PublicMessage =
  | { role: "user" | "assistant"; content: string; toolCalls?: PublicToolCall[] }
  | { role: "tool"; content: string; toolCallId: string; name: string };

export function publicMessages(messages: ChatMessage[]): PublicMessage[] {
  const visible: PublicMessage[] = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    if (message.role === "tool") {
      visible.push({
        role: "tool",
        content: message.content,
        toolCallId: message.toolCallId ?? "",
        name: message.name ?? "",
      });
      continue;
    }
    if (
      message.role === "assistant" &&
      message.toolCalls &&
      message.toolCalls.length > 0
    ) {
      visible.push({
        role: "assistant",
        content: message.content,
        toolCalls: message.toolCalls.map((call) => ({
          id: call.id,
          name: call.name,
          arguments: parseArguments(call.arguments),
        })),
      });
      continue;
    }
    visible.push({ role: message.role, content: message.content });
  }
  return visible;
}
