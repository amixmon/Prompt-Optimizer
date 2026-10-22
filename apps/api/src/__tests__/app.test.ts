import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { DEFAULT_OPTIONS, type OptimizeResponse } from "@prompt-studio/shared";
import { createApp } from "../app.js";

const testKey = "fixture-only-not-a-real-key";
let configured = true;
let providerStatus = 200;
let providerCalls = 0;
const app = createApp({
  config: () => ({ apiKey: configured ? testKey : "", model: "openai/gpt-oss-20b" }),
  fetch: async () => {
    providerCalls++;
    return Response.json(
      providerStatus === 200
        ? {
            choices: [
              {
                finish_reason: "stop",
                message: {
                  content: "Explain recursion with a clear definition and a practical example.",
                },
              },
            ],
          }
        : { error: `private provider text ${testKey}` },
      { status: providerStatus },
    );
  },
});
const server = app.listen(0, "127.0.0.1");
let baseUrl: string;

before(async () => {
  if (!server.listening) await once(server, "listening");
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

function validBody() {
  return {
    prompt: "Explain recursion.",
    technique: "structured",
    options: { ...DEFAULT_OPTIONS },
  };
}

function post(body: unknown) {
  return fetch(`${baseUrl}/api/optimize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("health identifies the AI backend and reports configuration presence", async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok", mode: "ai", configured: true });
});

test("valid optimize request returns one AI rewrite for the selected technique", async () => {
  const response = await post(validBody());
  assert.equal(response.status, 200);
  const body = (await response.json()) as OptimizeResponse;
  assert.equal(body.original.prompt, validBody().prompt);
  assert.deepEqual(
    body.variants.map(({ technique }) => technique),
    ["structured"],
  );
  assert.equal(body.original.analysis.checks.length, 5);
  assert.deepEqual(body.generation, { provider: "groq", model: "openai/gpt-oss-20b" });
});

test("missing, empty, null, wrong-type, and unsupported requests return useful 400 errors", async () => {
  const callsBefore = providerCalls;
  const invalidRequests: unknown[] = [
    {},
    null,
    [],
    { ...validBody(), prompt: "   " },
    { ...validBody(), prompt: 123 },
    { ...validBody(), technique: "unknown" },
    { ...validBody(), options: null },
    { ...validBody(), options: { ...DEFAULT_OPTIONS, format: "xml" } },
    { ...validBody(), options: { ...DEFAULT_OPTIONS, audience: 42 } },
    { ...validBody(), options: { ...DEFAULT_OPTIONS, length: null } },
    { ...validBody(), options: { ...DEFAULT_OPTIONS, context: 42 } },
    { ...validBody(), extra: true },
    { ...validBody(), options: { ...DEFAULT_OPTIONS, extra: true } },
  ];
  for (const input of invalidRequests) {
    const response = await post(input);
    assert.equal(response.status, 400, JSON.stringify(input));
    assert.equal(typeof ((await response.json()) as { error: unknown }).error, "string");
  }
  assert.equal(providerCalls, callsBefore);
});

test("field limits reject overlong values before calling the AI provider", async () => {
  const callsBefore = providerCalls;
  const cases = [
    { ...validBody(), prompt: "x".repeat(8_001) },
    { ...validBody(), options: { ...DEFAULT_OPTIONS, audience: "x".repeat(121) } },
    { ...validBody(), options: { ...DEFAULT_OPTIONS, length: "x".repeat(81) } },
    { ...validBody(), options: { ...DEFAULT_OPTIONS, context: "x".repeat(2_001) } },
    { ...validBody(), options: { ...DEFAULT_OPTIONS, example: "x".repeat(2_001) } },
  ];
  for (const input of cases) {
    const response = await post(input);
    assert.equal(response.status, 400);
    assert.match(((await response.json()) as { error: string }).error, /no more than/);
  }
  assert.equal(providerCalls, callsBefore);
});

test("malformed JSON, oversized JSON, and wrong content types receive proper statuses", async () => {
  const malformed = await fetch(`${baseUrl}/api/optimize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{broken",
  });
  assert.equal(malformed.status, 400);
  assert.match(((await malformed.json()) as { error: string }).error, /Invalid JSON/);

  const oversized = await post({ ...validBody(), prompt: "x".repeat(33_000) });
  assert.equal(oversized.status, 413);

  const wrongType = await fetch(`${baseUrl}/api/optimize`, { method: "POST", body: "text" });
  assert.equal(wrongType.status, 415);
});

test("unknown API paths return JSON instead of a frontend page", async () => {
  const response = await fetch(`${baseUrl}/api/missing`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "API route not found." });
});

test("configuration exposes no secrets and missing keys return 503 without fallback or external calls", async () => {
  const response = await fetch(`${baseUrl}/api/config`);
  assert.deepEqual(await response.json(), {
    configured: true,
    provider: "groq",
    model: "openai/gpt-oss-20b",
  });
  const callsBefore = providerCalls;
  configured = false;
  try {
    const missing = await post(validBody());
    assert.equal(missing.status, 503);
    const body = await missing.text();
    assert.match(body, /GROQ_API_KEY/);
    assert.ok(!body.includes(testKey));
    assert.ok(!body.includes("variants"));
    assert.equal(providerCalls, callsBefore);
    const updated = await fetch(`${baseUrl}/api/config`);
    assert.equal(((await updated.json()) as { configured: boolean }).configured, false);
  } finally {
    configured = true;
  }
});

test("provider rate limits remain friendly API errors without leaking provider bodies", async () => {
  providerStatus = 429;
  try {
    const response = await post(validBody());
    assert.equal(response.status, 429);
    const body = await response.text();
    assert.match(body, /limit/);
    assert.ok(!body.includes(testKey));
    assert.ok(!body.includes("private provider text"));
  } finally {
    providerStatus = 200;
  }
});
