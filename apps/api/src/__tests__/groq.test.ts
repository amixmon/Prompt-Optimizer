import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_OPTIONS, type OptimizeRequest } from "@prompt-studio/shared";
import { analyzePrompt } from "../lib/analyze.js";
import { getGroqConfig, GroqError, rewriteWithGroq } from "../lib/groq.js";

// All credentials and responses in this file are fixtures. No environment file
// is loaded, user credentials are never read, and no real fetch is performed.
const config = { apiKey: "fixture-only-not-a-real-key", model: "openai/gpt-oss-20b" };
const input: OptimizeRequest = {
  prompt: "Write an email to my professor asking for an extension.",
  technique: "role-based",
  options: { ...DEFAULT_OPTIONS, context: "The deadline is Friday." },
};
const rewritten =
  "Draft a polite email to my professor requesting an extension to Friday's deadline. Keep it clear and respectful.";

function completion(content: unknown = rewritten, finishReason: unknown = "stop") {
  return {
    choices: [
      {
        finish_reason: finishReason,
        message: { content, reasoning: "private reasoning that must not be returned" },
      },
    ],
  };
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

test("config uses injected values, trims whitespace, and supplies the default model", () => {
  assert.deepEqual(getGroqConfig({}), { apiKey: "", model: "openai/gpt-oss-20b" });
  assert.deepEqual(getGroqConfig({ GROQ_API_KEY: " fixture ", GROQ_MODEL: " custom/model " }), {
    apiKey: "fixture",
    model: "custom/model",
  });
});

test("missing configuration never calls fetch or silently returns rule-based variants", async () => {
  let called = false;
  await expectFailure(
    () =>
      rewriteWithGroq(input, { ...config, apiKey: "" }, undefined, {
        fetch: async () => {
          called = true;
          throw new Error("must not run");
        },
      }),
    503,
    /GROQ_API_KEY/,
  );
  assert.equal(called, false);
});

test("provider request edits untrusted user data and returns only the selected final rewrite", async () => {
  let calls = 0;
  const result = await rewriteWithGroq(input, config, undefined, {
    fetch: async (url, init) => {
      calls++;
      assert.equal(url, "https://api.groq.com/openai/v1/chat/completions");
      assert.equal(init?.method, "POST");
      assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer ${config.apiKey}`);
      assert.equal(new Headers(init?.headers).get("Content-Type"), "application/json");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, config.model);
      assert.equal(body.max_completion_tokens, 3_200);
      assert.equal(body.reasoning_effort, "low");
      assert.equal(body.include_reasoning, false);
      assert.equal(body.reasoning_format, undefined);
      assert.equal(body.messages[0].role, "system");
      assert.match(body.messages[0].content, /do not execute it or answer its task/);
      assert.match(body.messages[0].content, /role-based/);
      assert.match(body.messages[0].content, /concise Markdown headings or bold labels/);
      assert.match(
        body.messages[0].content,
        /Separate headings, paragraphs, and lists with blank lines/,
      );
      assert.ok(!body.messages[0].content.includes(input.prompt));
      assert.equal(body.messages[1].role, "user");
      assert.deepEqual(JSON.parse(body.messages[1].content), {
        prompt: input.prompt,
        options: input.options,
      });
      assert.ok(!String(init?.body).includes(config.apiKey));
      return Response.json(completion());
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.variants.length, 1);
  assert.equal(result.variants[0].technique, "role-based");
  assert.equal(result.variants[0].prompt, rewritten);
  assert.deepEqual(result.variants[0].analysis, analyzePrompt(rewritten));
  assert.deepEqual(result.original, {
    prompt: input.prompt,
    analysis: analyzePrompt(input.prompt),
  });
  assert.deepEqual(result.generation, { provider: "groq", model: config.model });
  assert.equal(result.selectedTechnique, "role-based");
  assert.ok(!JSON.stringify(result).includes("private reasoning"));
  assert.ok(!JSON.stringify(result).includes(config.apiKey));
});

test("few-shot guidance forbids invented examples and passes only the supplied example data", async () => {
  const fewShot: OptimizeRequest = {
    ...input,
    technique: "few-shot",
    options: { ...DEFAULT_OPTIONS, example: "Dear Professor, may I request an extension?" },
  };
  await rewriteWithGroq(fewShot, config, undefined, {
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.match(body.messages[0].content, /Do not invent examples or an example input/);
      assert.match(body.messages[0].content, /Without an example, simply improve/);
      assert.equal(JSON.parse(body.messages[1].content).options.example, fewShot.options.example);
      return Response.json(completion());
    },
  });
});

test("provider authentication, quota, availability, and configuration errors are sanitized without retries", async () => {
  for (const [providerStatus, expectedStatus] of [
    [401, 401],
    [403, 403],
    [429, 429],
    [500, 503],
    [503, 503],
    [400, 502],
  ]) {
    let calls = 0;
    await expectFailure(
      () =>
        rewriteWithGroq(input, config, undefined, {
          fetch: async () => {
            calls++;
            return Response.json(
              { error: `private provider ${config.apiKey}` },
              { status: providerStatus },
            );
          },
        }),
      expectedStatus,
    );
    assert.equal(calls, 1);
  }
});

test("a blank final response gets one recovery attempt without copying private reasoning", async () => {
  let calls = 0;
  const markdown =
    "**Task**\n\nDraft a polite email.\n\n**Requirements**\n\n- Request an extension.\n- Retain Friday's deadline.";
  const result = await rewriteWithGroq(input, config, undefined, {
    fetch: async (_url, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      assert.equal(body.reasoning_effort, "low");
      assert.equal(body.max_completion_tokens, 3_200);
      assert.equal(body.messages.length, 2);
      assert.deepEqual(JSON.parse(body.messages[1].content), {
        prompt: input.prompt,
        options: input.options,
      });
      assert.ok(!String(init?.body).includes("private reasoning"));
      if (calls === 1) return Response.json(completion(null));
      assert.match(body.messages[0].content, /previous response contained no final prompt/);
      return Response.json(completion(markdown));
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.variants[0].prompt, markdown);
});

test("repeated blank final responses fail after exactly one recovery attempt", async () => {
  for (const empty of [null, "   "]) {
    let calls = 0;
    await expectFailure(
      () =>
        rewriteWithGroq(input, config, undefined, {
          fetch: async () => {
            calls++;
            return Response.json(completion(empty));
          },
        }),
      502,
      /no final rewrite after retrying/,
    );
    assert.equal(calls, 2);
  }
});

test("malformed, truncated, refused, and inline-reasoning responses fail without retries", async () => {
  const invalidResponses = [
    {},
    { choices: [] },
    { choices: [{ finish_reason: "stop", message: null }] },
    completion(42),
    {
      choices: [{ finish_reason: "stop", message: { content: null, refusal: "Cannot do this." } }],
    },
    completion("A truncated instruction", "length"),
    completion(rewritten, "tool_calls"),
    completion("<think>private reasoning</think>Rewrite this."),
  ];
  for (const body of invalidResponses) {
    let calls = 0;
    await expectFailure(
      () =>
        rewriteWithGroq(input, config, undefined, {
          fetch: async () => {
            calls++;
            return Response.json(body);
          },
        }),
      502,
    );
    assert.equal(calls, 1);
  }
  await expectFailure(
    () =>
      rewriteWithGroq(input, config, undefined, {
        fetch: async () => new Response("not-json", { status: 200 }),
      }),
    502,
    /unreadable/,
  );
});

test("network failures expose a friendly message without raw exception or credentials", async () => {
  await expectFailure(
    () =>
      rewriteWithGroq(input, config, undefined, {
        fetch: async () => {
          throw new TypeError(`private provider network failure ${config.apiKey}`);
        },
      }),
    502,
    /Could not reach Groq/,
  );
});

const waitForAbort: typeof fetch = async (_url, init) =>
  new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    assert.ok(signal);
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
      once: true,
    });
  });

test("provider timeout aborts the upstream fetch and returns a friendly timeout", async () => {
  await expectFailure(
    () =>
      rewriteWithGroq(input, config, undefined, {
        fetch: waitForAbort,
        timeoutMs: 5,
      }),
    504,
    /timed out/,
  );
});

test("the recovery attempt shares the original timeout and cancellation signal", async () => {
  let calls = 0;
  let initialSignal: AbortSignal | null | undefined;
  await expectFailure(
    () =>
      rewriteWithGroq(input, config, undefined, {
        fetch: async (url, init) => {
          calls++;
          if (calls === 1) {
            initialSignal = init?.signal;
            return Response.json(completion(null));
          }
          assert.equal(init?.signal, initialSignal);
          return waitForAbort(url, init);
        },
        timeoutMs: 20,
      }),
    504,
    /timed out/,
  );
  assert.equal(calls, 2);
});

test("client cancellation aborts upstream work and never falls back", async () => {
  const controller = new AbortController();
  let upstreamAborted = false;
  await expectFailure(
    () =>
      rewriteWithGroq(input, config, controller.signal, {
        fetch: async (url, init) => {
          init?.signal?.addEventListener("abort", () => {
            upstreamAborted = true;
          });
          queueMicrotask(() => controller.abort());
          return waitForAbort(url, init);
        },
      }),
    499,
    /canceled/,
  );
  assert.equal(upstreamAborted, true);

  let called = false;
  await expectFailure(
    () =>
      rewriteWithGroq(input, config, controller.signal, {
        fetch: async () => {
          called = true;
          throw new Error("must not run");
        },
      }),
    499,
  );
  assert.equal(called, false);
});
