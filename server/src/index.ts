import OpenAI from "openai";
import { MockChatClient } from "./agent/mock.js";
import { OpenAIChatClient, SdkCompletionStreamer } from "./agent/openai.js";
import { loadConfig, loadEnvFile } from "./config.js";
import { createApp } from "./http/app.js";
import { ConversationStore } from "./memory/store.js";
import { tools } from "./tools/registry.js";

loadEnvFile();
const config = loadConfig(process.env);

const client =
  config.mode === "openai"
    ? new OpenAIChatClient(
        new SdkCompletionStreamer(new OpenAI({ apiKey: config.apiKey })),
        config.model,
      )
    : new MockChatClient();

const app = createApp({
  store: new ConversationStore(),
  client,
  tools,
  mode: config.mode,
  model: config.model,
});

app.listen(config.port, () => {
  console.log(
    `Assistant API listening on http://localhost:${config.port} (${config.mode})`,
  );
});
