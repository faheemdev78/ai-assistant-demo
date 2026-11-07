import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type AssistantMode = "mock" | "openai";

export interface AppConfig {
  apiKey: string;
  mode: AssistantMode;
  port: number;
  model: string;
}

export function repoRoot(): string {
  return fileURLToPath(new URL("../../", import.meta.url));
}

/** Load a local .env without overriding variables already set in the process. */
export function loadEnvFile(file = path.join(repoRoot(), ".env")): void {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const stripped = line.startsWith("export ")
      ? line.slice("export ".length).trim()
      : line;
    const eq = stripped.indexOf("=");
    if (eq <= 0) continue;
    const key = stripped.slice(0, eq).trim();
    let value = stripped.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const apiKey = env.OPENAI_API_KEY?.trim() ?? "";
  const mockRaw = env.MOCK_MODE?.trim().toLowerCase() ?? "";
  const forceMock = mockRaw === "true" || mockRaw === "1" || mockRaw === "yes";
  const forceLive = mockRaw === "false" || mockRaw === "0" || mockRaw === "no";

  if (forceLive && !apiKey) {
    throw new Error("MOCK_MODE=false requires OPENAI_API_KEY");
  }

  const portValue = Number(env.PORT ?? "3001");
  const port =
    Number.isInteger(portValue) && portValue > 0 && portValue < 65536 ? portValue : 3001;
  const model = env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  const mode: AssistantMode = forceMock || !apiKey ? "mock" : "openai";

  return { apiKey, mode, port, model };
}
