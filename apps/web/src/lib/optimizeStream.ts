import type { OptimizeRequest, OptimizeResponse, OptimizeStreamEvent } from "@prompt-studio/shared";

const INVALID_STREAM = "The rewrite response could not be read. Please try again.";

function parseEvent(line: string): OptimizeStreamEvent {
  let event: OptimizeStreamEvent;
  try {
    event = JSON.parse(line);
  } catch {
    throw new Error(INVALID_STREAM);
  }
  if (!event || typeof event !== "object") throw new Error(INVALID_STREAM);
  if (event.type === "delta" && typeof event.text === "string") return event;
  if (event.type === "error" && typeof event.error === "string") return event;
  if (
    event.type === "complete" &&
    event.result &&
    typeof event.result.id === "string" &&
    typeof event.result.original?.prompt === "string" &&
    Array.isArray(event.result.variants) &&
    event.result.variants.length > 0 &&
    event.result.variants.every((variant) => typeof variant?.prompt === "string")
  ) {
    return event;
  }
  throw new Error(INVALID_STREAM);
}

export async function streamOptimizePrompt(
  request: OptimizeRequest,
  signal: AbortSignal,
  onDelta: (text: string) => void,
  fetcher: typeof fetch = fetch,
): Promise<OptimizeResponse> {
  signal.throwIfAborted();
  const response = await fetcher("/api/optimize/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw new Error(
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : "The prompt could not be optimized. Please try again.",
    );
  }
  if (!response.body || !response.headers.get("Content-Type")?.includes("application/x-ndjson")) {
    throw new Error(INVALID_STREAM);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const abort = () => void reader.cancel().catch(() => {});
  signal.addEventListener("abort", abort, { once: true });

  function consume(line: string): OptimizeResponse | undefined {
    if (!line.trim()) return;
    const event = parseEvent(line);
    if (event.type === "error") throw new Error(event.error);
    if (event.type === "complete") return event.result;
    onDelta(event.text);
  }

  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      buffer += decoder.decode(value, { stream: !done });
      let lineEnd: number;
      while ((lineEnd = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + 1);
        const result = consume(line);
        if (result) return result;
      }
      if (done) {
        const result = consume(buffer);
        if (result) return result;
        throw new Error("The response ended before the rewrite finished. Please try again.");
      }
    }
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
