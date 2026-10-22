import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type { Request, RequestHandler, Response as ExpressResponse } from "express";
import { DEFAULT_OPTIONS } from "@prompt-studio/shared";
import { createApp } from "../app.js";
import { createRequestLimits } from "../lib/request-limits.js";

function attempt(limiter: RequestHandler, address = "192.0.2.1", forwarded = address) {
  const request = Object.assign(new EventEmitter(), {
    socket: { remoteAddress: address },
    headers: { "x-forwarded-for": forwarded },
    ip: forwarded,
    aborted: false,
  });
  let status = 200;
  let body: unknown;
  let accepted = false;
  const headers = new Map<string, string>();
  const response = Object.assign(new EventEmitter(), {
    destroyed: false,
    set(name: string, value: string) {
      headers.set(name, value);
      return response;
    },
    status(value: number) {
      status = value;
      return response;
    },
    json(value: unknown) {
      body = value;
      return response;
    },
  });
  limiter(request as unknown as Request, response as unknown as ExpressResponse, () => {
    accepted = true;
  });
  return { request, response, headers, status, body, accepted };
}

function complete(limiter: RequestHandler, address?: string, forwarded?: string) {
  const result = attempt(limiter, address, forwarded);
  if (result.accepted) result.response.emit("finish");
  return result;
}

test("per-IP windows reject spoofed forwarded addresses and reset when expired", () => {
  let time = 0;
  const limiter = createRequestLimits({ perIp: 2, global: 10, windowMs: 5_000, now: () => time });
  assert.equal(complete(limiter, "192.0.2.1", "198.51.100.1").accepted, true);
  assert.equal(complete(limiter, "192.0.2.1", "198.51.100.2").accepted, true);
  time = 1_100;
  const denied = complete(limiter, "192.0.2.1", "198.51.100.3");
  assert.equal(denied.status, 429);
  assert.equal(denied.accepted, false);
  assert.equal(denied.headers.get("Retry-After"), "4");
  assert.match((denied.body as { error: string }).error, /rewrite limit/);
  time = 5_000;
  assert.equal(complete(limiter).accepted, true);
});

test("global budget applies across distinct client addresses", () => {
  let time = 0;
  const limiter = createRequestLimits({ perIp: 5, global: 2, now: () => time });
  assert.equal(complete(limiter, "192.0.2.1").accepted, true);
  assert.equal(complete(limiter, "192.0.2.2").accepted, true);
  const denied = complete(limiter, "192.0.2.3");
  assert.equal(denied.status, 429);
  assert.equal(denied.headers.get("Retry-After"), "60");
  time = 60_000;
  assert.equal(complete(limiter, "192.0.2.3").accepted, true);
});

test("concurrency slots release exactly once on completion, disconnect, or cancellation", () => {
  const limiter = createRequestLimits({ perIp: 20, global: 20, concurrent: 2 });
  const first = attempt(limiter);
  const second = attempt(limiter);
  assert.equal(first.accepted && second.accepted, true);
  const busy = attempt(limiter);
  assert.equal(busy.status, 429);
  assert.equal(busy.headers.get("Retry-After"), "1");
  first.request.emit("aborted");
  first.response.emit("close");
  first.response.emit("finish");
  const third = attempt(limiter);
  assert.equal(third.accepted, true);
  assert.equal(attempt(limiter).status, 429, "duplicate close events must not release extra slots");
  second.response.emit("close");
  const fourth = attempt(limiter);
  assert.equal(fourth.accepted, true);
  third.response.emit("finish");
  const fifth = attempt(limiter);
  assert.equal(fifth.accepted, true);
  assert.equal(attempt(limiter).status, 429);
  fourth.response.emit("finish");
  fifth.response.emit("finish");
});

test("client tracking stays bounded and expired entries allow new clients", () => {
  let time = 0;
  const limiter = createRequestLimits({ maxClients: 2, global: 10, now: () => time });
  assert.equal(complete(limiter, "192.0.2.1").accepted, true);
  assert.equal(complete(limiter, "192.0.2.2").accepted, true);
  assert.equal(complete(limiter, "192.0.2.3").status, 429);
  assert.equal(complete(limiter, "192.0.2.1").accepted, true);
  time = 60_000;
  assert.equal(complete(limiter, "192.0.2.3").accepted, true);
});

test("invalid limit configuration fails immediately", () => {
  assert.throws(() => createRequestLimits({ concurrent: 0 }), /positive safe integers/);
  assert.throws(() => createRequestLimits({ windowMs: Number.POSITIVE_INFINITY }));
});

test("production shares the quota between both rewrite routes and leaves health available", async () => {
  const previousMode = process.env.NODE_ENV;
  let providerCalls = 0;
  process.env.NODE_ENV = "production";
  const app = createApp({
    config: () => ({ apiKey: "fixture-only-key", model: "fixture-model" }),
    fetch: async (_url, init) => {
      providerCalls++;
      const input = JSON.parse(String(init?.body)) as { stream?: boolean };
      if (input.stream) {
        return new Response(
          `data: ${JSON.stringify({ choices: [{ delta: { content: "Explain recursion clearly." }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
          { headers: { "Content-Type": "text/event-stream" } },
        );
      }
      return Response.json({
        choices: [{ message: { content: "Explain recursion clearly." }, finish_reason: "stop" }],
      });
    },
  });
  if (previousMode === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousMode;

  const server = app.listen(0, "127.0.0.1");
  try {
    if (!server.listening) await once(server, "listening");
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = (stream: boolean, forwarded: string) =>
      fetch(`${url}/api/optimize${stream ? "/stream" : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": forwarded },
        body: JSON.stringify({
          prompt: "Explain recursion.",
          technique: "structured",
          options: DEFAULT_OPTIONS,
        }),
      });
    for (let index = 0; index < 6; index++) {
      const response = await post(index % 2 === 0, `192.0.2.${index}`);
      assert.equal(response.status, 200);
      await response.text();
    }
    const denied = await post(true, "198.51.100.1");
    assert.equal(denied.status, 429);
    assert.ok(Number(denied.headers.get("Retry-After")) > 0);
    assert.match(((await denied.json()) as { error: string }).error, /rewrite limit/);
    assert.equal(providerCalls, 6, "limited requests must not reach Groq");
    assert.equal((await fetch(`${url}/api/health`)).status, 200);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
