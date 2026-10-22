import { performance } from "node:perf_hooks";
import type { OptimizeRequest, OptimizeResponse } from "@prompt-studio/shared";
import {
  createRewriteResult,
  EMPTY_REWRITE_RECOVERY,
  EmptyRewriteError,
  GROQ_ENDPOINT,
  GroqError,
  statusError,
  systemInstructions,
  type GroqConfig,
  type GroqDependencies,
} from "./groq.js";

const invalidStream = () =>
  new GroqError(502, "Groq returned an incomplete or invalid rewrite. Please try again.");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// SSE frames and UTF-8 characters can be split anywhere in a network read.
// Ignore every SSE field except data, and bound unfinished provider frames.
async function* readSseData(body: ReadableStream<Uint8Array>, signal: AbortSignal) {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let data: string[] = [];
  let frameSize = 0;
  const onAbort = () => void reader.cancel().catch(() => {});
  signal.addEventListener("abort", onAbort, { once: true });

  function takeFrames(final: boolean) {
    const frames: string[] = [];
    while (true) {
      const end = buffer.search(/[\r\n]/u);
      if (end < 0 || (!final && buffer[end] === "\r" && end === buffer.length - 1)) break;
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + (buffer[end] === "\r" && buffer[end + 1] === "\n" ? 2 : 1));
      if (!line) {
        if (data.length) frames.push(data.join("\n"));
        data = [];
        frameSize = 0;
      } else if (line === "data" || line.startsWith("data:")) {
        const value = line === "data" ? "" : line.slice(line[5] === " " ? 6 : 5);
        frameSize += value.length;
        if (frameSize > 65_536) throw invalidStream();
        data.push(value);
      }
    }
    if (buffer.length > 65_536) throw invalidStream();
    return frames;
  }

  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      for (const frame of takeFrames(done)) yield frame;
      if (done) break;
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

// Hold only a possible marker prefix, not a timer or a whole response. This
// prevents split inline reasoning tags from leaking even their first bytes.
class PublicTextGuard {
  private pending = "";
  private readonly markers = ["think", "analysis", "reasoning"]
    .flatMap((tag) => [`<${tag}`, `</${tag}`])
    .concat(["<|analysis", "<|channel", "<|start"]);

  push(text: string): string {
    const combined = this.pending + text;
    if (/<\/?(?:think|analysis|reasoning)\b|<\|(?:analysis|channel|start)/iu.test(combined)) {
      throw new GroqError(502, "Groq did not return a clean prompt rewrite. Please try again.");
    }
    this.pending = "";
    const start = combined.lastIndexOf("<");
    if (
      start >= 0 &&
      this.markers.some((marker) => marker.startsWith(combined.slice(start).toLowerCase()))
    ) {
      this.pending = combined.slice(start);
      return combined.slice(0, start);
    }
    return combined;
  }

  finish() {
    return this.pending;
  }
}

export async function streamRewriteWithGroq(
  request: OptimizeRequest,
  config: GroqConfig,
  onDelta: (text: string) => void | Promise<void>,
  clientSignal?: AbortSignal,
  dependencies: GroqDependencies = {},
): Promise<OptimizeResponse> {
  if (!config.apiKey) {
    throw new GroqError(
      503,
      "AI rewriting is not configured. Add GROQ_API_KEY to apps/api/.env and restart the backend.",
    );
  }
  if (clientSignal?.aborted) throw new GroqError(499, "The rewrite request was canceled.");

  const startedAt = performance.now();
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), dependencies.timeoutMs ?? 20_000);
  const signal = clientSignal
    ? AbortSignal.any([clientSignal, timeoutController.signal])
    : timeoutController.signal;
  let emitted = false;

  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      signal.throwIfAborted();
      const response = await (dependencies.fetch ?? fetch)(GROQ_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        signal,
        body: JSON.stringify({
          model: config.model,
          messages: [
            {
              role: "system",
              content:
                systemInstructions(request) + (attempt > 0 ? `\n${EMPTY_REWRITE_RECOVERY}` : ""),
            },
            {
              role: "user",
              content: JSON.stringify({ prompt: request.prompt, options: request.options }),
            },
          ],
          max_completion_tokens: 3_200,
          temperature: 0.4,
          stream: true,
          ...(config.model.startsWith("openai/gpt-oss")
            ? { reasoning_effort: "low", include_reasoning: false }
            : {}),
        }),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw statusError(response.status);
      }
      if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
        await response.body?.cancel().catch(() => {});
        throw invalidStream();
      }

      const guard = new PublicTextGuard();
      let prompt = "";
      let leading = "";
      let finished = false;
      let done = false;
      const publish = async (text: string) => {
        prompt += text;
        if (prompt.length > 131_072) throw invalidStream();
        if (!emitted) {
          leading += text;
          if (!leading.trim()) return;
          text = leading.trimStart();
          leading = "";
        }
        if (text) {
          signal.throwIfAborted();
          emitted = true;
          await onDelta(text);
        }
      };

      for await (const data of readSseData(response.body, signal)) {
        if (data === "[DONE]") {
          done = true;
          break;
        }
        let payload: unknown;
        try {
          payload = JSON.parse(data);
        } catch {
          throw invalidStream();
        }
        if (!isRecord(payload) || !Array.isArray(payload.choices)) throw invalidStream();
        if (!payload.choices.length) continue; // Optional usage-only frame.
        const choice = payload.choices[0];
        if (!isRecord(choice) || !isRecord(choice.delta)) throw invalidStream();
        const delta = choice.delta;
        if (
          (typeof delta.refusal === "string" && delta.refusal.trim()) ||
          delta.tool_calls ||
          delta.function_call
        ) {
          throw new GroqError(
            502,
            "The AI could not rewrite this prompt. Try adjusting your request.",
          );
        }
        if (delta.content != null && typeof delta.content !== "string") throw invalidStream();
        if (typeof delta.content === "string" && delta.content) {
          if (finished) throw invalidStream();
          await publish(guard.push(delta.content));
        }
        // Separate reasoning fields are intentionally never read or returned.
        if (choice.finish_reason != null) {
          if (choice.finish_reason === "length") {
            throw new GroqError(
              502,
              "The AI rewrite was cut short. Try again with a shorter prompt.",
            );
          }
          if (choice.finish_reason !== "stop" || finished) throw invalidStream();
          finished = true;
        }
      }
      if (!finished || !done) throw invalidStream();
      await publish(guard.finish());
      if (prompt.trim()) return createRewriteResult(request, config, prompt.trim(), startedAt);
      // A recovery request is safe only before any public text was sent.
      if (emitted || attempt > 0) throw new EmptyRewriteError();
    }
    throw new EmptyRewriteError();
  } catch (error) {
    if (clientSignal?.aborted) throw new GroqError(499, "The rewrite request was canceled.");
    if (timeoutController.signal.aborted) {
      throw new GroqError(504, "The AI rewrite timed out. Please try again.");
    }
    if (error instanceof GroqError) throw error;
    throw new GroqError(502, "Could not reach Groq. Check your internet connection and try again.");
  } finally {
    clearTimeout(timeout);
  }
}
