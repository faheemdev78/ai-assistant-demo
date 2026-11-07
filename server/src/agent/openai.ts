import OpenAI from "openai";
import type {
  ChatCompletionChunk,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import type { AnyTool } from "../tools/define.js";
import type { ChatMessage, ModelEvent } from "../types.js";
import type { ChatClient } from "./loop.js";

export interface CompletionStreamer {
  stream(params: {
    model: string;
    messages: ChatCompletionMessageParam[];
    tools: ChatCompletionTool[];
  }): Promise<AsyncIterable<ChatCompletionChunk>>;
}

export class SdkCompletionStreamer implements CompletionStreamer {
  constructor(private readonly openai: OpenAI) {}

  stream(params: {
    model: string;
    messages: ChatCompletionMessageParam[];
    tools: ChatCompletionTool[];
  }): Promise<AsyncIterable<ChatCompletionChunk>> {
    return this.openai.chat.completions.create({
      model: params.model,
      messages: params.messages,
      tools: params.tools,
      stream: true,
    });
  }
}

export class OpenAIChatClient implements ChatClient {
  constructor(
    private readonly streamer: CompletionStreamer,
    private readonly model: string,
  ) {}

  async *stream(input: {
    messages: ChatMessage[];
    tools: AnyTool[];
  }): AsyncGenerator<ModelEvent> {
    const chunks = await this.streamer.stream({
      model: this.model,
      messages: toOpenAIMessages(input.messages),
      tools: toOpenAITools(input.tools),
    });
    yield* eventsFromChunks(chunks);
  }
}

export function toOpenAITools(toolList: AnyTool[]): ChatCompletionTool[] {
  return toolList.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters(),
    },
  }));
}

export function toOpenAIMessages(messages: ChatMessage[]): ChatCompletionMessageParam[] {
  return messages.map((message) => {
    if (message.role === "system") {
      return { role: "system", content: message.content };
    }
    if (message.role === "user") {
      return { role: "user", content: message.content };
    }
    if (message.role === "tool") {
      return {
        role: "tool",
        content: message.content,
        tool_call_id: message.toolCallId ?? "",
      };
    }
    return {
      role: "assistant",
      content: message.content || null,
      ...(message.toolCalls && message.toolCalls.length > 0
        ? {
            tool_calls: message.toolCalls.map((call) => ({
              id: call.id,
              type: "function" as const,
              function: { name: call.name, arguments: call.arguments },
            })),
          }
        : {}),
    };
  });
}

export async function* eventsFromChunks(
  chunks: AsyncIterable<ChatCompletionChunk>,
): AsyncGenerator<ModelEvent> {
  const calls = new Map<number, { id: string; name: string; arguments: string }>();
  let finish: "stop" | "tool_calls" | "length" = "stop";

  for await (const chunk of chunks) {
    const choice = chunk.choices[0];
    if (!choice) continue;
    if (choice.delta.content) yield { type: "text", delta: choice.delta.content };
    for (const toolCall of choice.delta.tool_calls ?? []) {
      const current = calls.get(toolCall.index) ?? { id: "", name: "", arguments: "" };
      if (toolCall.id) current.id += toolCall.id;
      if (toolCall.function?.name) current.name += toolCall.function.name;
      if (toolCall.function?.arguments) current.arguments += toolCall.function.arguments;
      calls.set(toolCall.index, current);
    }
    if (
      choice.finish_reason === "stop" ||
      choice.finish_reason === "tool_calls" ||
      choice.finish_reason === "length"
    ) {
      finish = choice.finish_reason;
    }
  }

  for (const call of calls.values()) {
    yield {
      type: "tool_call",
      call: {
        id: call.id || `call_${crypto.randomUUID()}`,
        name: call.name,
        arguments: call.arguments || "{}",
      },
    };
  }

  yield { type: "finish", reason: calls.size > 0 ? "tool_calls" : finish };
}
