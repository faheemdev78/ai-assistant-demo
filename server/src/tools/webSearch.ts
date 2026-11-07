import { z } from "zod";
import { defineTool } from "./define.js";

export const webSearchInput = z.object({
  query: z.string().trim().min(1).max(200).describe("Search query"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(5)
    .default(3)
    .describe("How many stub results to return"),
});

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const TEMPLATES: Array<{
  title: (query: string) => string;
  snippet: (query: string) => string;
}> = [
  {
    title: (query) => `${query} — overview`,
    snippet: (query) => `A short briefing on ${query}, written by the demo search stub.`,
  },
  {
    title: (query) => `Practical notes on ${query}`,
    snippet: (query) => `Implementation notes and tradeoffs related to ${query}.`,
  },
  {
    title: (query) => `${query} reference`,
    snippet: (query) =>
      `Reference-style summary of ${query}. This result was not retrieved from the internet.`,
  },
  {
    title: (query) => `Common questions about ${query}`,
    snippet: (query) => `A handful of questions people ask when learning ${query}.`,
  },
  {
    title: (query) => `${query} in practice`,
    snippet: (query) =>
      `A worked example that mentions ${query}. Still a stub, not a live page.`,
  },
];

export function stubSearch(
  query: string,
  limit: number,
): { query: string; source: "stub"; results: SearchResult[] } {
  const trimmed = query.trim();
  const encoded = encodeURIComponent(trimmed);
  const results = TEMPLATES.slice(0, limit).map((template, index) => ({
    title: template.title(trimmed),
    url: `https://example.com/search?q=${encoded}&result=${index + 1}`,
    snippet: template.snippet(trimmed),
  }));
  return { query: trimmed, source: "stub", results };
}

export const webSearchTool = defineTool({
  name: "web_search",
  description:
    "Return stubbed search results for a query. This tool does not access the internet.",
  schema: webSearchInput,
  execute: (input) => stubSearch(input.query, input.limit),
});
