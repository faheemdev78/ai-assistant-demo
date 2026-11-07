import { z } from "zod";
import { defineTool } from "./define.js";

const CONDITIONS = ["Clear", "Cloudy", "Rain", "Windy", "Snow"] as const;

export const weatherInput = z.object({
  location: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .describe("City or region, for example Lisbon"),
  unit: z.enum(["celsius", "fahrenheit"]).default("celsius").describe("Temperature unit"),
});

export type WeatherInput = z.output<typeof weatherInput>;

export interface WeatherReport {
  location: string;
  temperature: number;
  unit: "celsius" | "fahrenheit";
  condition: (typeof CONDITIONS)[number];
  humidity: number;
  source: "mock";
}

export function hashLocation(location: string): number {
  let hash = 2166136261;
  for (const char of location.trim().toLowerCase()) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function mockWeather(
  location: string,
  unit: "celsius" | "fahrenheit",
): WeatherReport {
  const hash = hashLocation(location);
  const celsius = (hash % 45) - 10;
  const temperature =
    unit === "fahrenheit" ? Math.round((celsius * 9) / 5 + 32) : celsius;
  const condition = CONDITIONS[hash % CONDITIONS.length] ?? "Clear";
  return {
    location: location.trim(),
    temperature,
    unit,
    condition,
    humidity: 30 + (hash % 61),
    source: "mock",
  };
}

export const weatherTool = defineTool({
  name: "get_weather",
  description:
    "Get a mocked weather report for a location. The reading is deterministic and is not live weather.",
  schema: weatherInput,
  execute: (input) => mockWeather(input.location, input.unit),
});
