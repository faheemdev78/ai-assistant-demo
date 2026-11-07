import type { AnyTool } from "../tools/define.js";
import type { ConversationMemory } from "../memory/store.js";
import type { AgentEvent, ChatMessage, ModelEvent, ToolCall } from "../types.js";

export interface ChatClient {
  stream(input: { messages: ChatMessage[]; tools: AnyTool[] }): AsyncIterable<ModelEvent>;
}

const DEFAULT_MAX_STEPS = 4;

export async function* runAgent(options: {
  client: ChatClient;
  memory: ConversationMemory;
  tools: AnyTool[];
  userText: string;
  maxSteps?: number;
}): AsyncGenerator<AgentEvent> {
  const { client, memory, tools, userText } = options;
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  memory.append({ role: "user", content: userText });

  for (let step = 0; step < maxSteps; step += 1) {
    let text = "";
    const calls: ToolCall[] = [];
    let finish: AgentEvent & { type: "done" } = { type: "done", finishReason: "stop" };

    for await (const event of client.stream({ messages: memory.messages, tools })) {
      if (event.type === "text") {
        text += event.delta;
        yield { type: "text", delta: event.delta };
      } else if (event.type === "tool_call") {
        calls.push(event.call);
      } else {
        finish = { type: "done", finishReason: event.reason };
      }
    }

    if (calls.length === 0) {
      memory.append({ role: "assistant", content: text });
      yield finish;
      return;
    }

    memory.append({ role: "assistant", content: text, toolCalls: calls });
    for (const call of calls) {
      const args = parseArguments(call.arguments);
      yield { type: "tool_call", id: call.id, name: call.name, arguments: args };
      const outcome = await runNamedTool(tools, call.name, args);
      memory.append({
        role: "tool",
        content: JSON.stringify(outcome),
        toolCallId: call.id,
        name: call.name,
      });
      yield {
        type: "tool_result",
        id: call.id,
        name: call.name,
        ok: outcome.ok,
        result: outcome.ok ? outcome.data : { error: outcome.error },
      };
    }
  }

  const message = "I stopped after several tool calls without a final answer.";
  memory.append({ role: "assistant", content: message });
  yield { type: "text", delta: message };
  yield { type: "done", finishReason: "length" };
}

export async function runNamedTool(
  toolList: AnyTool[],
  name: string,
  args: unknown,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const tool = toolList.find((candidate) => candidate.name === name);
  if (!tool) return { ok: false, error: `Unknown tool: ${name}` };
  return tool.run(args);
}

export function parseArguments(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return { raw: trimmed };
  }
}
