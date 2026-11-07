import { beforeEach, describe, expect, it } from "vitest";
import {
  MockChatClient,
  extractExpression,
  extractLocation,
  plan,
} from "../src/agent/mock.js";
import { runAgent, type ChatClient } from "../src/agent/loop.js";
import { ConversationMemory } from "../src/memory/store.js";
import { resetToolState, tools } from "../src/tools/registry.js";
import type { ChatMessage, ModelEvent } from "../src/types.js";
import { collect, textOf } from "./helpers.js";

class ScriptedClient implements ChatClient {
  readonly seen: ChatMessage[][] = [];
  calls = 0;

  constructor(private readonly scripts: ModelEvent[][]) {}

  async *stream(input: { messages: ChatMessage[] }): AsyncGenerator<ModelEvent> {
    this.seen.push(input.messages.map((message) => ({ ...message })));
    const script = this.scripts[this.calls] ?? [];
    this.calls += 1;
    for (const event of script) yield event;
  }
}

describe("agent loop", () => {
  beforeEach(() => {
    resetToolState();
  });

  it("executes a tool call and feeds the result back to the model", async () => {
    const client = new ScriptedClient([
      [
        {
          type: "tool_call",
          call: { id: "call_1", name: "calculate", arguments: '{"expression":"2+2"}' },
        },
        { type: "finish", reason: "tool_calls" },
      ],
      [
        { type: "text", delta: "The answer is 4." },
        { type: "finish", reason: "stop" },
      ],
    ]);
    const memory = new ConversationMemory();
    const events = await collect(
      runAgent({
        client,
        memory,
        tools,
        userText: "What is 2+2?",
      }),
    );

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool_call",
          name: "calculate",
          arguments: { expression: "2+2" },
        }),
        expect.objectContaining({
          type: "tool_result",
          name: "calculate",
          ok: true,
          result: { expression: "2+2", result: 4 },
        }),
      ]),
    );
    expect(textOf(events)).toBe("The answer is 4.");
    expect(client.calls).toBe(2);
    const secondTurn = client.seen[1];
    expect(secondTurn?.some((message) => message.role === "tool")).toBe(true);
    expect(secondTurn?.find((message) => message.role === "tool")?.content).toContain(
      '"result":4',
    );
    expect(memory.messages.map((message) => message.role)).toEqual([
      "system",
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
  });

  it("reports an unknown tool and still lets the model answer", async () => {
    const client = new ScriptedClient([
      [
        {
          type: "tool_call",
          call: { id: "call_x", name: "missing", arguments: "{}" },
        },
        { type: "finish", reason: "tool_calls" },
      ],
      [
        { type: "text", delta: "That tool is not available." },
        { type: "finish", reason: "stop" },
      ],
    ]);
    const events = await collect(
      runAgent({
        client,
        memory: new ConversationMemory(),
        tools,
        userText: "Do something unknown",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_result",
        ok: false,
        result: { error: "Unknown tool: missing" },
      }),
    );
    expect(textOf(events)).toContain("not available");
  });

  it("stops after the configured number of tool steps", async () => {
    const toolCall: ModelEvent = {
      type: "tool_call",
      call: { id: "call_loop", name: "calculate", arguments: '{"expression":"1+1"}' },
    };
    const client = new ScriptedClient([
      [toolCall, { type: "finish", reason: "tool_calls" }],
      [toolCall, { type: "finish", reason: "tool_calls" }],
      [toolCall, { type: "finish", reason: "tool_calls" }],
    ]);
    const events = await collect(
      runAgent({
        client,
        memory: new ConversationMemory(),
        tools,
        userText: "Keep calculating",
        maxSteps: 2,
      }),
    );
    expect(client.calls).toBe(2);
    expect(events.filter((event) => event.type === "tool_result")).toHaveLength(2);
    expect(textOf(events)).toMatch(/stopped after several tool calls/i);
    expect(events.at(-1)).toEqual({ type: "done", finishReason: "length" });
  });

  it("stores a plain reply when the model does not call a tool", async () => {
    const client = new ScriptedClient([
      [
        { type: "text", delta: "Hello" },
        { type: "finish", reason: "stop" },
      ],
    ]);
    const memory = new ConversationMemory();
    const events = await collect(runAgent({ client, memory, tools, userText: "Hi" }));
    expect(textOf(events)).toBe("Hello");
    expect(events.at(-1)).toEqual({ type: "done", finishReason: "stop" });
    expect(memory.messages.at(-1)).toMatchObject({ role: "assistant", content: "Hello" });
  });
});

describe("mock model", () => {
  beforeEach(() => {
    resetToolState();
  });

  it("routes the suggestion prompts to the right tools", () => {
    expect(plan("What's the weather in Lisbon?")).toMatchObject({
      name: "get_weather",
      arguments: { location: "Lisbon" },
    });
    expect(plan("Calculate (18 * 4) / 3")).toMatchObject({
      name: "calculate",
      arguments: { expression: "(18 * 4) / 3" },
    });
    expect(plan("Save a note: ship the demo")).toMatchObject({
      name: "notes",
      arguments: { action: "create", title: "ship the demo" },
    });
    expect(plan("Search for server-sent events")).toMatchObject({
      name: "web_search",
      arguments: { query: "server-sent events" },
    });
    expect(extractLocation("weather in New York please")).toBe("New York");
    expect(extractExpression("what is -5 + 2")).toBe("-5 + 2");
  });

  it("answers a weather question by calling the tool and summarizing it", async () => {
    const events = await collect(
      runAgent({
        client: new MockChatClient(0),
        memory: new ConversationMemory(),
        tools,
        userText: "What's the weather in Oslo?",
      }),
    );
    expect(
      events.some((event) => event.type === "tool_call" && event.name === "get_weather"),
    ).toBe(true);
    expect(events.some((event) => event.type === "tool_result" && event.ok)).toBe(true);
    const answer = textOf(events).toLowerCase();
    expect(answer).toContain("oslo");
    expect(answer).toContain("mocked");
  });

  it("saves a note and says the id back", async () => {
    const events = await collect(
      runAgent({
        client: new MockChatClient(0),
        memory: new ConversationMemory(),
        tools,
        userText: "Save a note: ship the demo",
      }),
    );
    const answer = textOf(events);
    expect(answer).toContain("n_1");
    expect(answer.toLowerCase()).toContain("ship the demo");
  });

  it("keeps conversation memory across two mock turns", async () => {
    const memory = new ConversationMemory();
    const client = new MockChatClient(0);
    await collect(
      runAgent({ client, memory, tools, userText: "Save a note: ship the demo" }),
    );
    const events = await collect(
      runAgent({ client, memory, tools, userText: "Show my notes" }),
    );
    expect(textOf(events)).toContain("n_1");
    expect(memory.messages.filter((message) => message.role === "user")).toHaveLength(2);
  });
});

describe("conversation memory", () => {
  it("keeps the system prompt and the most recent messages", () => {
    const memory = new ConversationMemory();
    for (let index = 0; index < 50; index += 1) {
      memory.append({ role: "user", content: `message ${index}` });
    }
    expect(memory.messages[0]?.role).toBe("system");
    expect(memory.messages).toHaveLength(41);
    expect(memory.messages.at(-1)?.content).toBe("message 49");
    expect(memory.messages[1]?.content).toBe("message 10");
  });
});
