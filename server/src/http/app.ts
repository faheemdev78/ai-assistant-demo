import fs from "node:fs";
import path from "node:path";
import express, { type ErrorRequestHandler, type Express } from "express";
import cors from "cors";
import { z } from "zod";
import { runAgent, type ChatClient } from "../agent/loop.js";
import type { AssistantMode } from "../config.js";
import { repoRoot } from "../config.js";
import { ConversationStore } from "../memory/store.js";
import type { AnyTool } from "../tools/define.js";
import { formatZodError } from "../tools/define.js";
import { publicMessages } from "./present.js";

const chatRequest = z.object({
  message: z.string().trim().min(1).max(4000),
  conversationId: z.string().trim().min(1).max(80).optional(),
});

export interface AppDeps {
  store: ConversationStore;
  client: ChatClient;
  tools: AnyTool[];
  mode: AssistantMode;
  model: string;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors());
  app.use(express.json({ limit: "32kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      mode: deps.mode,
      model: deps.mode === "openai" ? deps.model : "mock",
    });
  });

  app.get("/api/tools", (_req, res) => {
    res.json({
      tools: deps.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
      })),
    });
  });

  app.get("/api/conversations/:id", (req, res) => {
    const memory = deps.store.get(req.params.id);
    if (!memory) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    res.json({ id: req.params.id, messages: publicMessages(memory.messages) });
  });

  app.delete("/api/conversations/:id", (req, res) => {
    if (!deps.store.delete(req.params.id)) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }
    res.json({ deleted: true });
  });

  app.post("/api/chat", async (req, res) => {
    const parsed = chatRequest.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: formatZodError(parsed.error) });
      return;
    }

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    let clientGone = false;
    res.on("close", () => {
      clientGone = !res.writableEnded;
    });

    const send = (event: string, data: unknown) => {
      if (clientGone) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const conversation = deps.store.open(parsed.data.conversationId);
    send("meta", { conversationId: conversation.id, mode: deps.mode });

    try {
      for await (const event of runAgent({
        client: deps.client,
        memory: conversation.memory,
        tools: deps.tools,
        userText: parsed.data.message,
      })) {
        if (clientGone) return;
        if (event.type === "text") send("text", { delta: event.delta });
        else if (event.type === "tool_call") {
          send("tool_call", {
            id: event.id,
            name: event.name,
            arguments: event.arguments,
          });
        } else if (event.type === "tool_result") {
          send("tool_result", {
            id: event.id,
            name: event.name,
            ok: event.ok,
            result: event.result,
          });
        } else {
          send("done", { finishReason: event.finishReason });
        }
      }
    } catch (error) {
      console.error(error);
      send("error", { message: "The assistant failed to respond." });
    } finally {
      res.end();
    }
  });

  const webDist = path.join(repoRoot(), "web", "dist");
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.use((req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") {
        next();
        return;
      }
      if (req.path.startsWith("/api")) {
        next();
        return;
      }
      res.sendFile(path.join(webDist, "index.html"), (error) => {
        if (error) next();
      });
    });
  }

  const onError: ErrorRequestHandler = (error, _req, res, _next) => {
    console.error(error);
    if (res.headersSent) return;
    res.status(500).json({ error: "Internal server error" });
  };
  app.use(onError);

  return app;
}
