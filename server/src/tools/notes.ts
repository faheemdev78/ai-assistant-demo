import { z } from "zod";
import { defineTool } from "./define.js";

export interface Note {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

const notes = new Map<string, Note>();
let sequence = 0;

export function resetNotes(): void {
  notes.clear();
  sequence = 0;
}

const noteId = z.string().trim().min(1).max(40).describe("Note id such as n_1");

export const notesInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(4000),
  }),
  z.object({
    action: z.literal("list"),
  }),
  z.object({
    action: z.literal("get"),
    id: noteId,
  }),
  z
    .object({
      action: z.literal("update"),
      id: noteId,
      title: z.string().trim().min(1).max(120).optional(),
      body: z.string().trim().min(1).max(4000).optional(),
    })
    .refine((value) => value.title !== undefined || value.body !== undefined, {
      message: "Provide a title or a body to update",
      path: ["title"],
    }),
  z.object({
    action: z.literal("delete"),
    id: noteId,
  }),
]);

export type NotesInput = z.output<typeof notesInput>;

function nowIso(): string {
  return new Date().toISOString();
}

export function applyNotes(input: NotesInput): unknown {
  switch (input.action) {
    case "create": {
      sequence += 1;
      const timestamp = nowIso();
      const note: Note = {
        id: `n_${sequence}`,
        title: input.title,
        body: input.body,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      notes.set(note.id, note);
      return note;
    }
    case "list":
      return { notes: [...notes.values()] };
    case "get": {
      const note = notes.get(input.id);
      if (!note) throw new Error(`Note not found: ${input.id}`);
      return note;
    }
    case "update": {
      const note = notes.get(input.id);
      if (!note) throw new Error(`Note not found: ${input.id}`);
      if (input.title !== undefined) note.title = input.title;
      if (input.body !== undefined) note.body = input.body;
      note.updatedAt = nowIso();
      return note;
    }
    case "delete": {
      if (!notes.delete(input.id)) throw new Error(`Note not found: ${input.id}`);
      return { id: input.id, deleted: true };
    }
    default: {
      const unreachable: never = input;
      return unreachable;
    }
  }
}

export const notesTool = defineTool({
  name: "notes",
  description:
    "Create, list, get, update, or delete notes stored in server memory. Notes disappear when the process restarts. Pass action create, list, get, update, or delete.",
  schema: notesInput,
  execute: (input) => applyNotes(input),
});
