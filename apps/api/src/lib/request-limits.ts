import type { RequestHandler } from "express";

export interface RequestLimitOptions {
  perIp?: number;
  global?: number;
  concurrent?: number;
  windowMs?: number;
  maxClients?: number;
  now?: () => number;
}

interface WindowCount {
  count: number;
  expiresAt: number;
}

// One instance covers both rewrite routes. These modest process-local limits
// protect a student demo's provider quota without a database or proxy changes.
export function createRequestLimits(options: RequestLimitOptions = {}): RequestHandler {
  const perIp = options.perIp ?? 6;
  const global = options.global ?? 12;
  const concurrent = options.concurrent ?? 2;
  const windowMs = options.windowMs ?? 60_000;
  const maxClients = options.maxClients ?? 4_096;
  const now = options.now ?? Date.now;
  for (const value of [perIp, global, concurrent, windowMs, maxClients]) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error("Request limits must be positive safe integers.");
    }
  }

  const clients = new Map<string, WindowCount>();
  let total: WindowCount = { count: 0, expiresAt: now() + windowMs };
  let active = 0;

  return (request, response, next) => {
    if (request.aborted || response.destroyed) return;
    const time = now();
    let earliestExpiry = time + windowMs;
    for (const [address, entry] of clients) {
      if (entry.expiresAt <= time) clients.delete(address);
      else earliestExpiry = Math.min(earliestExpiry, entry.expiresAt);
    }
    if (total.expiresAt <= time) total = { count: 0, expiresAt: time + windowMs };

    // This service is exposed directly on its own port. Forwarded headers are
    // user-controlled and must never create a different quota identity.
    const address = request.socket.remoteAddress ?? "unknown";
    const client = clients.get(address);
    let retryMs = 0;
    let message = "";
    if (client && client.count >= perIp) {
      retryMs = client.expiresAt - time;
      message = "You have reached the rewrite limit. Wait a little and try again.";
    } else if (total.count >= global) {
      retryMs = total.expiresAt - time;
      message = "The app's rewrite limit has been reached. Wait a little and try again.";
    } else if (!client && clients.size >= maxClients) {
      retryMs = earliestExpiry - time;
      message = "The app is busy. Wait a little and try again.";
    } else if (active >= concurrent) {
      retryMs = 1_000;
      message = "The app is handling other rewrites. Please try again shortly.";
    }
    if (message) {
      response.set("Retry-After", String(Math.max(1, Math.ceil(retryMs / 1_000))));
      response.status(429).json({ error: message });
      return;
    }

    clients.set(address, {
      count: (client?.count ?? 0) + 1,
      expiresAt: client?.expiresAt ?? time + windowMs,
    });
    total.count++;
    active++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      active--;
      request.off("aborted", release);
      response.off("finish", release);
      response.off("close", release);
    };
    request.once("aborted", release);
    response.once("finish", release);
    response.once("close", release);
    next();
  };
}
