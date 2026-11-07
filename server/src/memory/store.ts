import type { ChatMessage } from "../types.js";

export const SYSTEM_PROMPT = [
  "You are a concise assistant in a public demo.",
  "Use a tool when it clearly helps, then explain the result in plain language.",
  "Do not invent tool results.",
  "get_weather is mocked and deterministic, not a live forecast.",
  "web_search returns stub results and does not browse the internet.",
  "notes live only in this server process and disappear on restart.",
  "calculate evaluates arithmetic and nothing else.",
].join(" ");

const MAX_STORED_MESSAGES = 40;

export class ConversationMemory {
  readonly messages: ChatMessage[];

  constructor(messages?: ChatMessage[]) {
    this.messages = messages ?? [{ role: "system", content: SYSTEM_PROMPT }];
  }

  append(message: ChatMessage): void {
    this.messages.push(message);
    this.trim();
  }

  private trim(): void {
    const system = this.messages[0];
    if (!system || this.messages.length <= MAX_STORED_MESSAGES + 1) return;
    const recent = this.messages.slice(-MAX_STORED_MESSAGES);
    const kept = recent.filter((message) => message !== system);
    this.messages.length = 0;
    this.messages.push(system, ...kept);
  }
}

export class ConversationStore {
  private readonly conversations = new Map<string, ConversationMemory>();

  create(): { id: string; memory: ConversationMemory } {
    const id = crypto.randomUUID();
    const memory = new ConversationMemory();
    this.conversations.set(id, memory);
    return { id, memory };
  }

  get(id: string): ConversationMemory | undefined {
    return this.conversations.get(id);
  }

  open(id: string | undefined): { id: string; memory: ConversationMemory } {
    if (id) {
      const existing = this.conversations.get(id);
      if (existing) return { id, memory: existing };
    }
    return this.create();
  }

  delete(id: string): boolean {
    return this.conversations.delete(id);
  }
}
