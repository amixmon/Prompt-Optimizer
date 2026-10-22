import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { DEFAULT_OPTIONS, type OptimizeStreamEvent } from "@prompt-studio/shared";
import { createApp } from "../app.js";

const encoder = new TextEncoder();
const input = {
  prompt: "Explain recursion.",
  technique: "structured",
  options: { ...DEFAULT_OPTIONS },
};
const frame = (content: string | null, finishReason: string | null = null) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: finishReason }] })}\n\n`;

async function withServer(
  dependencies: Parameters<typeof createApp>[0],
  action: (url: string) => Promise<void>,
) {
  const server = createApp(dependencies).listen(0, "127.0.0.1");
  try {
    if (!server.listening) await once(server, "listening");
    await action(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/optimize/stream`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

function post(url: string, body: unknown = input, signal?: AbortSignal) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

test("HTTP streaming flushes a delta before the provider completes, then a final result", async () => {
  let upstream: ReadableStreamDefaultController<Uint8Array>;
  await withServer(
    {
      config: () => ({ apiKey: "fixture-only-key", model: "openai/gpt-oss-20b" }),
      fetch: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              upstream = controller;
              controller.enqueue(encoder.encode(frame("Explain recursion")));
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        ),
    },
    async (url) => {
      const response = await post(url);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type")!, /application\/x-ndjson/);
      assert.equal(response.headers.get("x-accel-buffering"), "no");
      const reader = response.body!.getReader();
      const first = new TextDecoder().decode((await reader.read()).value);
      assert.deepEqual(JSON.parse(first), { type: "delta", text: "Explain recursion" });
      upstream!.enqueue(
        encoder.encode(frame(" with an example.") + frame(null, "stop") + "data: [DONE]\n\n"),
      );
      upstream!.close();
      let remaining = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        remaining += new TextDecoder().decode(value);
      }
      const events = remaining
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as OptimizeStreamEvent);
      assert.equal(events[0].type, "delta");
      const complete = events.at(-1)!;
      assert.equal(complete.type, "complete");
      if (complete.type === "complete")
        assert.equal(complete.result.variants[0].prompt, "Explain recursion with an example.");
    },
  );
});

test("failures after public output end with a sanitized error event and no success", async () => {
  await withServer(
    {
      config: () => ({ apiKey: "fixture-only-key", model: "openai/gpt-oss-20b" }),
      fetch: async () =>
        new Response(frame("Incomplete prompt") + frame(null, "length") + "data: [DONE]\n\n", {
          headers: { "Content-Type": "text/event-stream" },
        }),
    },
    async (url) => {
      const response = await post(url);
      assert.equal(response.status, 200);
      const events = (await response.text())
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as OptimizeStreamEvent);
      assert.equal(events[0].type, "delta");
      assert.deepEqual(events.at(-1), {
        type: "error",
        error: "The AI rewrite was cut short. Try again with a shorter prompt.",
      });
      assert.ok(!events.some((event) => event.type === "complete"));
    },
  );
});

test("stream endpoint validates input and configuration before starting its response", async () => {
  let calls = 0;
  await withServer(
    {
      config: () => ({ apiKey: "", model: "openai/gpt-oss-20b" }),
      fetch: async () => {
        calls++;
        throw new Error("must not call provider");
      },
    },
    async (url) => {
      const invalid = await post(url, { ...input, prompt: "" });
      assert.equal(invalid.status, 400);
      const missing = await post(url);
      assert.equal(missing.status, 503);
      assert.match(missing.headers.get("content-type")!, /application\/json/);
      assert.match(((await missing.json()) as { error: string }).error, /GROQ_API_KEY/);
      assert.equal(calls, 0);
    },
  );
});

test("disconnecting the browser cancels the provider stream", { timeout: 2_000 }, async () => {
  let canceled: () => void;
  const upstreamCanceled = new Promise<void>((resolve) => {
    canceled = resolve;
  });
  await withServer(
    {
      config: () => ({ apiKey: "fixture-only-key", model: "openai/gpt-oss-20b" }),
      fetch: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoder.encode(frame("Explain recursion")));
            },
            cancel() {
              canceled();
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        ),
    },
    async (url) => {
      const controller = new AbortController();
      const response = await post(url, input, controller.signal);
      await response.body!.getReader().read();
      controller.abort();
      await upstreamCanceled;
    },
  );
});
