import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_OPTIONS,
  type OptimizeRequest,
  type OptimizeResponse,
} from "@prompt-studio/shared";
import { streamOptimizePrompt } from "../optimizeStream.js";

const request: OptimizeRequest = {
  prompt: "Write a café invitation.",
  technique: "structured",
  options: { ...DEFAULT_OPTIONS },
};
const analysis = { score: 0, wordCount: 4, checks: [] };
const result: OptimizeResponse = {
  id: "fixture-stream-result",
  original: { prompt: request.prompt, analysis },
  variants: [
    {
      technique: "structured",
      title: "Structured prompt",
      prompt: "Draft a café invitation.",
      analysis,
      changes: [],
    },
  ],
  selectedTechnique: "structured",
  elapsedMs: 1,
};
const encoder = new TextEncoder();
const line = (event: unknown) => encoder.encode(`${JSON.stringify(event)}\n`);
const mockFetch =
  (body: ReadableStream<Uint8Array>): typeof fetch =>
  async () =>
    new Response(body, { headers: { "Content-Type": "application/x-ndjson" } });

function closedStream(text: string) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

test("delivers split UTF-8 deltas before completion and returns without waiting for the stream to close", async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let canceled = false;
  let receivedDelta!: () => void;
  const firstDelta = new Promise<void>((resolve) => {
    receivedDelta = resolve;
  });
  const body = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
      const chunk = line({ type: "delta", text: "Draft a café invitation." });
      for (let index = 0; index < chunk.length; index++) {
        controller.enqueue(chunk.slice(index, index + 1));
      }
    },
    cancel() {
      canceled = true;
    },
  });
  const deltas: string[] = [];
  let completed = false;
  const pending = streamOptimizePrompt(
    request,
    new AbortController().signal,
    (text) => {
      deltas.push(text);
      receivedDelta();
    },
    mockFetch(body),
  ).then((value) => {
    completed = true;
    return value;
  });

  await firstDelta;
  assert.deepEqual(deltas, ["Draft a café invitation."]);
  assert.equal(completed, false);
  controller.enqueue(line({ type: "complete", result }));
  assert.deepEqual(await pending, result);
  assert.equal(canceled, true);
});

test("accepts a final complete event without a trailing newline", async () => {
  const response = await streamOptimizePrompt(
    request,
    new AbortController().signal,
    () => {},
    mockFetch(closedStream(JSON.stringify({ type: "complete", result }))),
  );
  assert.deepEqual(response, result);
});

test("streamed errors, malformed events, and unfinished responses never become completed rewrites", async () => {
  const failures: Array<[string, RegExp]> = [
    [JSON.stringify({ type: "error", error: "The Groq API limit has been reached." }), /API limit/],
    ["not JSON", /could not be read/],
    [JSON.stringify({ type: "complete", result: { variants: [] } }), /could not be read/],
    [`${JSON.stringify({ type: "delta", text: "Unfinished" })}\n`, /before the rewrite finished/],
  ];
  for (const [payload, message] of failures) {
    await assert.rejects(
      () =>
        streamOptimizePrompt(
          request,
          new AbortController().signal,
          () => {},
          mockFetch(closedStream(payload)),
        ),
      message,
    );
  }
});

test("HTTP errors retain the safe backend message and non-stream responses fail clearly", async () => {
  await assert.rejects(
    () =>
      streamOptimizePrompt(
        request,
        new AbortController().signal,
        () => {},
        async () => Response.json({ error: "Groq rejected the API credentials." }, { status: 401 }),
      ),
    /rejected the API credentials/,
  );
  await assert.rejects(
    () =>
      streamOptimizePrompt(
        request,
        new AbortController().signal,
        () => {},
        async () => new Response("<html>Proxy error</html>"),
      ),
    /could not be read/,
  );
});

test("canceling stops the reader and prevents a partial response from completing", async () => {
  const abortController = new AbortController();
  let canceled = false;
  let receivedDelta!: () => void;
  const firstDelta = new Promise<void>((resolve) => {
    receivedDelta = resolve;
  });
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(line({ type: "delta", text: "Partial" }));
    },
    cancel() {
      canceled = true;
    },
  });
  const pending = streamOptimizePrompt(
    request,
    abortController.signal,
    () => receivedDelta(),
    mockFetch(body),
  );
  await firstDelta;
  abortController.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(canceled, true);
});
