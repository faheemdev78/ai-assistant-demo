import { describe, expect, it } from "vitest";
import type {
  ChatCompletionChunk,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import {
  eventsFromChunks,
  OpenAIChatClient,
  type CompletionStreamer,
} from "../src/agent/openai.js";
import { ConversationMemory } from "../src/memory/store.js";
import { runAgent } from "../src/agent/loop.js";
import { tools } from "../src/tools/registry.js";
import { collect, textOf } from "./helpers.js";

function chunk(choice: ChatCompletionChunk.Choice): ChatCompletionChunk {
  return {
    id: "chatcmpl_test",
    object: "chat.completion.chunk",
    created: 0,
    model: "gpt-4o-mini",
    choices: [choice],
  };
}

async function collectModel(chunks: ChatCompletionChunk[]) {
  const events = [];
  for await (const event of eventsFromChunks(chunks)) events.push(event);
  return events;
}

describe("OpenAI stream assembly", () => {
  it("joins content deltas from a mocked completion stream", async () => {
    const events = await collectModel([
      chunk({ index: 0, finish_reason: null, delta: { content: "Hello" } }),
      chunk({ index: 0, finish_reason: null, delta: { content: " there" } }),
      chunk({ index: 0, finish_reason: "stop", delta: {} }),
    ]);
    expect(events).toEqual([
      { type: "text", delta: "Hello" },
      { type: "text", delta: " there" },
      { type: "finish", reason: "stop" },
    ]);
  });

  it("assembles a tool call that arrives across chunks", async () => {
    const events = await collectModel([
      chunk({
        index: 0,
        finish_reason: null,
        delta: {
          tool_calls: [
            { index: 0, id: "call_1", function: { name: "calculate", arguments: "" } },
          ],
        },
      }),
      chunk({
        index: 0,
        finish_reason: null,
        delta: { tool_calls: [{ index: 0, function: { arguments: '{"expression":' } }] },
      }),
      chunk({
        index: 0,
        finish_reason: "tool_calls",
        delta: { tool_calls: [{ index: 0, function: { arguments: '"2+2"}' } }] },
      }),
    ]);
    expect(events).toEqual([
      {
        type: "tool_call",
        call: {
          id: "call_1",
          name: "calculate",
          arguments: '{"expression":"2+2"}',
        },
      },
      { type: "finish", reason: "tool_calls" },
    ]);
  });
});

describe("OpenAI chat client", () => {
  it("uses the injected streamer and never calls the network", async () => {
    const seen: ChatCompletionMessageParam[][] = [];
    const streamer: CompletionStreamer = {
      async stream(params) {
        seen.push(params.messages);
        async function* chunks() {
          if (seen.length === 1) {
            yield chunk({
              index: 0,
              finish_reason: "tool_calls",
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_calc",
                    function: { name: "calculate", arguments: '{"expression":"2+2"}' },
                  },
                ],
              },
            });
            return;
          }
          yield chunk({ index: 0, finish_reason: null, delta: { content: "2+2 = 4." } });
          yield chunk({ index: 0, finish_reason: "stop", delta: {} });
        }
        return chunks();
      },
    };

    const events = await collect(
      runAgent({
        client: new OpenAIChatClient(streamer, "gpt-4o-mini"),
        memory: new ConversationMemory(),
        tools,
        userText: "What is 2+2?",
      }),
    );

    expect(textOf(events)).toBe("2+2 = 4.");
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_result",
        ok: true,
        result: { expression: "2+2", result: 4 },
      }),
    );
    const followUp = seen[1];
    expect(followUp?.some((message) => message.role === "tool")).toBe(true);
    expect(seen[0]?.[0]).toMatchObject({ role: "system" });
  });
});
