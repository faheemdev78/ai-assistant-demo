import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { MockChatClient } from "../src/agent/mock.js";
import { loadConfig } from "../src/config.js";
import { createApp } from "../src/http/app.js";
import { ConversationStore } from "../src/memory/store.js";
import { resetToolState, tools } from "../src/tools/registry.js";

describe("loadConfig", () => {
  it("uses mock mode without a key and live mode with one", () => {
    expect(loadConfig({}).mode).toBe("mock");
    expect(loadConfig({ OPENAI_API_KEY: "sk-test" })).toMatchObject({
      mode: "openai",
      apiKey: "sk-test",
      model: "gpt-4o-mini",
    });
    expect(loadConfig({ OPENAI_API_KEY: "sk-test", MOCK_MODE: "true" }).mode).toBe(
      "mock",
    );
    expect(loadConfig({ PORT: "8080" }).port).toBe(8080);
    expect(
      loadConfig({ OPENAI_MODEL: "gpt-4.1-mini", OPENAI_API_KEY: "sk-test" }).model,
    ).toBe("gpt-4.1-mini");
  });

  it("refuses live mode when the key is missing", () => {
    expect(() => loadConfig({ MOCK_MODE: "false" })).toThrow(/OPENAI_API_KEY/);
  });
});

describe("HTTP API", () => {
  let server: Server | undefined;

  afterEach(async () => {
    resetToolState();
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => (error ? reject(error) : resolve()));
    });
    server = undefined;
  });

  it("streams tool calls and text over SSE", async () => {
    const app = createApp({
      store: new ConversationStore(),
      client: new MockChatClient(0),
      tools,
      mode: "mock",
      model: "gpt-4o-mini",
    });
    server = await listen(app);
    const port = portOf(server);

    const health = await fetch(`http://127.0.0.1:${port}/api/health`);
    expect(await health.json()).toEqual({ ok: true, mode: "mock", model: "mock" });

    const catalog = await fetch(`http://127.0.0.1:${port}/api/tools`);
    const catalogBody = (await catalog.json()) as { tools: Array<{ name: string }> };
    expect(catalogBody.tools.map((tool) => tool.name)).toContain("calculate");

    const response = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Calculate (18 * 4) / 3" }),
    });
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const body = await response.text();
    expect(body).toContain("event: meta");
    expect(body).toContain("event: tool_call");
    expect(body).toContain("calculate");
    expect(body).toContain("event: tool_result");
    expect(body).toContain("event: text");
    expect(body).toContain("event: done");

    const conversationId = body.match(/"conversationId":"([^"]+)"/)?.[1];
    expect(conversationId).toBeTruthy();
    const history = await fetch(
      `http://127.0.0.1:${port}/api/conversations/${conversationId}`,
    );
    const historyBody = (await history.json()) as { messages: Array<{ role: string }> };
    expect(historyBody.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);

    const removed = await fetch(
      `http://127.0.0.1:${port}/api/conversations/${conversationId}`,
      {
        method: "DELETE",
      },
    );
    expect(await removed.json()).toEqual({ deleted: true });
    const missing = await fetch(
      `http://127.0.0.1:${port}/api/conversations/${conversationId}`,
    );
    expect(missing.status).toBe(404);
  });

  it("rejects an empty message", async () => {
    const app = createApp({
      store: new ConversationStore(),
      client: new MockChatClient(0),
      tools,
      mode: "mock",
      model: "mock",
    });
    server = await listen(app);
    const response = await fetch(`http://127.0.0.1:${portOf(server)}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "   " }),
    });
    expect(response.status).toBe(400);
  });
});

function listen(app: ReturnType<typeof createApp>): Promise<Server> {
  return new Promise((resolve) => {
    const started = app.listen(0, "127.0.0.1", () => resolve(started));
  });
}

function portOf(active: Server): number {
  const address = active.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP port");
  return address.port;
}
