import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_OPTIONS, type OptimizeRequest } from "@prompt-studio/shared";
import { streamRewriteWithGroq } from "../lib/groq-stream.js";
import { GroqError } from "../lib/groq.js";

// Injected fixtures only: these tests never load credentials or call Groq.
const config = { apiKey: "fixture-only-not-a-real-key", model: "openai/gpt-oss-20b" };
const input: OptimizeRequest = {
  prompt: "Explain recursion.",
  technique: "structured",
  options: { ...DEFAULT_OPTIONS },
};
const encoder = new TextEncoder();
const frame = (delta: Record<string, unknown>, finishReason: string | null = null) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finishReason }] })}\r\n\r\n`;
const done = "data: [DONE]\r\n\r\n";
const stop = frame({}, "stop");

function sse(text: string, oneByteAtATime = false) {
  const bytes = encoder.encode(text);
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        if (oneByteAtATime) {
          for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        } else controller.enqueue(bytes);
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream; charset=utf-8" } },
  );
}

async function expectFailure(action: () => Promise<unknown>, status: number, message?: RegExp) {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof GroqError);
    assert.equal(error.status, status);
    assert.ok(!error.message.includes(config.apiKey));
    assert.ok(!error.message.includes("private provider"));
    if (message) assert.match(error.message, message);
    return true;
  });
}

test("streams public content before completion without waiting for the final frame", async () => {
  let upstream: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      upstream = controller;
    },
  });
  const chunks: string[] = [];
  let firstDelta: () => void;
  const firstDeltaSeen = new Promise<void>((resolve) => {
    firstDelta = resolve;
  });
  const resultPromise = streamRewriteWithGroq(
    input,
    config,
    (text) => {
      chunks.push(text);
      firstDelta();
    },
    undefined,
    {
      fetch: async (_url, init) => {
        const request = JSON.parse(String(init?.body));
        assert.equal(request.stream, true);
        assert.equal(request.include_reasoning, false);
        assert.equal(request.reasoning_effort, "low");
        assert.equal(request.max_completion_tokens, 3_200);
        assert.match(request.messages[0].content, /do not execute it or answer its task/);
        return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
      },
    },
  );
  upstream!.enqueue(
    encoder.encode(frame({ reasoning: "private provider reasoning", content: "**Task**" })),
  );
  await firstDeltaSeen;
  assert.deepEqual(chunks, ["**Task**"]);
  upstream!.enqueue(
    encoder.encode(frame({ content: "\n\nExplain recursion clearly." }) + stop + done),
  );
  upstream!.close();
  const result = await resultPromise;
  assert.equal(chunks.join(""), "**Task**\n\nExplain recursion clearly.");
  assert.equal(result.variants[0].prompt, chunks.join(""));
  assert.deepEqual(result.generation, { provider: "groq", model: config.model });
  assert.ok(!JSON.stringify(result).includes("private provider"));
});

test("decodes split UTF-8, CRLF delimiters, multiline data, and ignores SSE metadata", async () => {
  const output = "Explain café recursion 🧠 with examples.";
  const firstFrame = `: keepalive\r\nevent: completion\r\nid: fixture\r\ndata: {\r\ndata: \"choices\": [{\"delta\":{\"content\":${JSON.stringify(output)}},\"finish_reason\":null}]}\r\n\r\n`;
  const chunks: string[] = [];
  const result = await streamRewriteWithGroq(
    input,
    config,
    (text) => {
      chunks.push(text);
    },
    undefined,
    {
      fetch: async () => sse(firstFrame + stop + done, true),
    },
  );
  assert.equal(chunks.join(""), output);
  assert.equal(result.variants[0].prompt, output);
});

test("rejects split inline reasoning before emitting any marker bytes or hidden text", async () => {
  for (const pieces of [
    ["<", "thi", "nk>private provider reasoning</think>"],
    ["A useful instruction. <", "|ana", "lysis private provider reasoning"],
    ["</", "reas", "oning>private provider reasoning"],
  ]) {
    const chunks: string[] = [];
    let calls = 0;
    await expectFailure(
      () =>
        streamRewriteWithGroq(
          input,
          config,
          (text) => {
            chunks.push(text);
          },
          undefined,
          {
            fetch: async () => {
              calls++;
              return sse(pieces.map((content) => frame({ content })).join("") + stop + done);
            },
          },
        ),
      502,
      /clean prompt/,
    );
    assert.equal(calls, 1);
    assert.ok(!chunks.join("").includes("<"));
    assert.ok(!chunks.join("").includes("private provider"));
  }
});

test("retries exactly once for a completed blank stream before any public text", async () => {
  let calls = 0;
  const chunks: string[] = [];
  const result = await streamRewriteWithGroq(
    input,
    config,
    (text) => {
      chunks.push(text);
    },
    undefined,
    {
      fetch: async (_url, init) => {
        calls++;
        if (calls === 1)
          return sse(
            frame({ content: " \n", reasoning: "private provider reasoning" }) + stop + done,
          );
        assert.match(
          JSON.parse(String(init?.body)).messages[0].content,
          /previous response contained no final prompt/,
        );
        return sse(frame({ content: "Explain recursion with an example." }) + stop + done);
      },
    },
  );
  assert.equal(calls, 2);
  assert.deepEqual(chunks, ["Explain recursion with an example."]);
  assert.equal(result.variants[0].prompt, chunks[0]);
});

test("never retries or returns success for truncated, malformed, refused, or unfinished streams", async () => {
  const invalid = [
    frame({ content: "Partial instruction" }) + frame({}, "length") + done,
    frame({ content: "Partial instruction" }) + done,
    frame({ content: "Partial instruction" }) + stop,
    frame({ content: "Partial instruction" }) + "data: private provider malformed JSON\n\n",
    frame({ refusal: "private provider refusal", content: "Do not publish" }) + stop + done,
    frame({
      tool_calls: [{ function: { name: "private provider tool" } }],
      content: "Do not publish",
    }) +
      stop +
      done,
    frame({ content: 42 }) + stop + done,
    frame({ content: "Useful instruction" }) + frame({}, "tool_calls") + done,
  ];
  for (const value of invalid) {
    let calls = 0;
    await expectFailure(
      () =>
        streamRewriteWithGroq(input, config, () => {}, undefined, {
          fetch: async () => {
            calls++;
            return sse(value);
          },
        }),
      502,
    );
    assert.equal(calls, 1);
  }
});

test("repeated empty streams fail after two attempts without emitting content", async () => {
  let calls = 0;
  const chunks: string[] = [];
  await expectFailure(
    () =>
      streamRewriteWithGroq(
        input,
        config,
        (text) => {
          chunks.push(text);
        },
        undefined,
        {
          fetch: async () => {
            calls++;
            return sse(frame({ content: null }) + stop + done);
          },
        },
      ),
    502,
    /no final rewrite after retrying/,
  );
  assert.equal(calls, 2);
  assert.deepEqual(chunks, []);
});

test("missing configuration and provider failures are sanitized without a fallback", async () => {
  let calls = 0;
  const dependencies = {
    fetch: async () => {
      calls++;
      return new Response(`private provider ${config.apiKey}`, { status: 429 });
    },
  };
  await expectFailure(
    () =>
      streamRewriteWithGroq(input, { ...config, apiKey: "" }, () => {}, undefined, dependencies),
    503,
  );
  assert.equal(calls, 0);
  await expectFailure(
    () => streamRewriteWithGroq(input, config, () => {}, undefined, dependencies),
    429,
    /limit/,
  );
  assert.equal(calls, 1);
});

test("timeout and client cancellation stop stalled stream reads and cancel the body", async () => {
  for (const mode of ["timeout", "client"] as const) {
    const controller = new AbortController();
    let canceled = false;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(body) {
          body.enqueue(encoder.encode(frame({ content: "Start writing" })));
        },
        cancel() {
          canceled = true;
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    );
    await expectFailure(
      () =>
        streamRewriteWithGroq(
          input,
          config,
          () => {
            if (mode === "client") controller.abort();
          },
          controller.signal,
          {
            fetch: async () => response,
            timeoutMs: mode === "timeout" ? 10 : 20_000,
          },
        ),
      mode === "timeout" ? 504 : 499,
      mode === "timeout" ? /timed out/ : /canceled/,
    );
    assert.equal(canceled, true);
  }
});
