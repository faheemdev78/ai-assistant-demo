import { z } from "zod";
import type { ToolResult } from "../types.js";

export interface AnyTool {
  name: string;
  description: string;
  parameters: () => Record<string, unknown>;
  run: (input: unknown) => Promise<ToolResult>;
}

export function defineTool<T>(tool: {
  name: string;
  description: string;
  schema: z.ZodType<T>;
  execute: (input: T) => unknown | Promise<unknown>;
}): AnyTool {
  return {
    name: tool.name,
    description: tool.description,
    parameters: () => jsonSchemaFor(tool.schema),
    async run(input: unknown): Promise<ToolResult> {
      const parsed = tool.schema.safeParse(input);
      if (!parsed.success) {
        return { ok: false, error: formatZodError(parsed.error) };
      }
      try {
        return { ok: true, data: await tool.execute(parsed.data) };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Tool failed";
        return { ok: false, error: message };
      }
    },
  };
}

export function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: "draft-07", io: "input" });
  const copy: Record<string, unknown> = { ...json };
  delete copy.$schema;
  return copy;
}

export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "input";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}
