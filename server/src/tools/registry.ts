import { calculatorTool } from "./calculator.js";
import { notesTool, resetNotes } from "./notes.js";
import { weatherTool } from "./weather.js";
import { webSearchTool } from "./webSearch.js";
import type { AnyTool } from "./define.js";

export const tools: AnyTool[] = [weatherTool, calculatorTool, notesTool, webSearchTool];

export function resetToolState(): void {
  resetNotes();
}

export function findTool(name: string): AnyTool | undefined {
  return tools.find((tool) => tool.name === name);
}
