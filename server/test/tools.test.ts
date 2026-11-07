import { beforeEach, describe, expect, it } from "vitest";
import { evaluateExpression, ExpressionError } from "../src/tools/calculator.js";
import { resetNotes } from "../src/tools/notes.js";
import { findTool, resetToolState, tools } from "../src/tools/registry.js";
import { hashLocation, mockWeather } from "../src/tools/weather.js";
import { stubSearch } from "../src/tools/webSearch.js";

describe("tool registry", () => {
  it("exposes the four demo tools with JSON schemas", () => {
    expect(tools.map((tool) => tool.name)).toEqual([
      "get_weather",
      "calculate",
      "notes",
      "web_search",
    ]);
    for (const tool of tools) {
      const schema = tool.parameters();
      expect(schema.$schema).toBeUndefined();
      expect(schema.type === "object" || Array.isArray(schema.oneOf)).toBe(true);
    }
  });
});

describe("get_weather", () => {
  const weather = findTool("get_weather");

  it("returns a deterministic mocked forecast and defaults to celsius", async () => {
    expect(weather).toBeDefined();
    const first = await weather?.run({ location: "  Oslo " });
    const second = await weather?.run({ location: "Oslo" });
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      ok: true,
      data: { location: "Oslo", unit: "celsius", source: "mock" },
    });
    if (first?.ok) {
      const report = first.data as {
        temperature: number;
        condition: string;
        humidity: number;
      };
      expect(Number.isInteger(report.temperature)).toBe(true);
      expect(["Clear", "Cloudy", "Rain", "Windy", "Snow"]).toContain(report.condition);
      expect(report.humidity).toBeGreaterThanOrEqual(30);
    }
  });

  it("converts the same location into fahrenheit", () => {
    const celsius = mockWeather("Lisbon", "celsius");
    const fahrenheit = mockWeather("Lisbon", "fahrenheit");
    expect(fahrenheit.temperature).toBe(Math.round((celsius.temperature * 9) / 5 + 32));
    expect(hashLocation("Lisbon")).toBe(hashLocation(" lisbon "));
  });

  it("rejects an empty location", async () => {
    const result = await weather?.run({ location: "   " });
    expect(result?.ok).toBe(false);
  });
});

describe("calculate", () => {
  const calculator = findTool("calculate");

  it("respects precedence, parentheses, decimals, and unary minus", () => {
    expect(evaluateExpression("2 + 3 * 4")).toBe(14);
    expect(evaluateExpression("(18 * 4) / 3")).toBe(24);
    expect(evaluateExpression("-5 + 2")).toBe(-3);
    expect(evaluateExpression("1.5 * 2")).toBe(3);
    expect(evaluateExpression("0.1 + 0.2")).toBeCloseTo(0.3, 10);
  });

  it("rejects division by zero and anything that is not arithmetic", () => {
    expect(() => evaluateExpression("10 / 0")).toThrow(ExpressionError);
    expect(() => evaluateExpression("2 + alert(1)")).toThrow(ExpressionError);
    expect(() => evaluateExpression("")).toThrow(ExpressionError);
    expect(() => evaluateExpression("(2 + 3")).toThrow(/Expected '\)'/);
  });

  it("returns the expression and the result through the tool", async () => {
    const result = await calculator?.run({ expression: "2+2" });
    expect(result).toEqual({ ok: true, data: { expression: "2+2", result: 4 } });
  });
});

describe("notes", () => {
  const notes = findTool("notes");

  beforeEach(() => {
    resetNotes();
  });

  it("creates, lists, gets, updates, and deletes notes", async () => {
    const created = await notes?.run({
      action: "create",
      title: "Ship the demo",
      body: "Write the README",
    });
    expect(created).toMatchObject({
      ok: true,
      data: { id: "n_1", title: "Ship the demo", body: "Write the README" },
    });

    const listed = await notes?.run({ action: "list" });
    expect(listed?.ok && Array.isArray((listed.data as { notes: unknown[] }).notes)).toBe(
      true,
    );
    expect((listed?.ok && (listed.data as { notes: unknown[] }).notes.length) || 0).toBe(
      1,
    );

    const fetched = await notes?.run({ action: "get", id: "n_1" });
    expect(fetched).toMatchObject({ ok: true, data: { id: "n_1" } });

    const updated = await notes?.run({ action: "update", id: "n_1", body: "Done" });
    expect(updated).toMatchObject({ ok: true, data: { id: "n_1", body: "Done" } });

    const removed = await notes?.run({ action: "delete", id: "n_1" });
    expect(removed).toEqual({ ok: true, data: { id: "n_1", deleted: true } });

    const missing = await notes?.run({ action: "get", id: "n_1" });
    expect(missing).toMatchObject({ ok: false });
  });

  it("rejects an update that changes nothing and a create without a body", async () => {
    expect((await notes?.run({ action: "update", id: "n_1" }))?.ok).toBe(false);
    expect((await notes?.run({ action: "create", title: "Only a title" }))?.ok).toBe(
      false,
    );
  });
});

describe("web_search", () => {
  it("returns stub results that mention the query and honors the limit", () => {
    const payload = stubSearch("server-sent events", 2);
    expect(payload.source).toBe("stub");
    expect(payload.results).toHaveLength(2);
    expect(payload.results[0]?.url).toContain("example.com");
    expect(payload.results[0]?.title.toLowerCase()).toContain("server-sent events");
    expect(
      payload.results.every((result) => result.url.startsWith("https://example.com/")),
    ).toBe(true);
  });

  it("rejects a limit outside the schema", async () => {
    const search = findTool("web_search");
    const result = await search?.run({ query: "types", limit: 9 });
    expect(result?.ok).toBe(false);
  });
});

describe("resetToolState", () => {
  it("clears notes", async () => {
    const notes = findTool("notes");
    await notes?.run({ action: "create", title: "Temp", body: "Temp" });
    resetToolState();
    const listed = await notes?.run({ action: "list" });
    expect(listed).toMatchObject({ ok: true, data: { notes: [] } });
  });
});
