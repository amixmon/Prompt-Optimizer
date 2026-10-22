import { existsSync } from "node:fs";
import { once } from "node:events";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import express, { type ErrorRequestHandler } from "express";
import type { OptimizeStreamEvent } from "@prompt-studio/shared";
import {
  getGroqConfig,
  GroqError,
  rewriteWithGroq,
  type GroqConfig,
  type GroqDependencies,
} from "./lib/groq.js";
import { streamRewriteWithGroq } from "./lib/groq-stream.js";
import { createRequestLimits } from "./lib/request-limits.js";
import { RequestValidationError, validateRequest } from "./lib/validation.js";

interface AppDependencies extends GroqDependencies {
  config?: () => GroqConfig;
}

export function createApp(dependencies: AppDependencies = {}) {
  const app = express();
  const config = dependencies.config ?? getGroqConfig;
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));

  if (process.env.NODE_ENV === "production") {
    app.post(["/api/optimize", "/api/optimize/stream"], createRequestLimits());
  }

  app.get("/api/health", (_request, response) => {
    response.json({ status: "ok", mode: "ai", configured: Boolean(config().apiKey) });
  });

  app.get("/api/config", (_request, response) => {
    const current = config();
    response.json({ configured: Boolean(current.apiKey), provider: "groq", model: current.model });
  });

  app.post("/api/optimize", async (request, response) => {
    if (!request.is("application/json")) {
      response.status(415).json({ error: "Use Content-Type: application/json." });
      return;
    }
    const input = validateRequest(request.body);
    const controller = new AbortController();
    const abort = () => controller.abort();
    const onClose = () => {
      if (!response.writableEnded) abort();
    };
    request.once("aborted", abort);
    response.once("close", onClose);
    if (request.aborted || response.destroyed) abort();
    try {
      const result = await rewriteWithGroq(input, config(), controller.signal, dependencies);
      if (!controller.signal.aborted) response.json(result);
    } finally {
      request.off("aborted", abort);
      response.off("close", onClose);
    }
  });

  app.post("/api/optimize/stream", async (request, response) => {
    if (!request.is("application/json")) {
      response.status(415).json({ error: "Use Content-Type: application/json." });
      return;
    }
    const input = validateRequest(request.body);
    const controller = new AbortController();
    const abort = () => controller.abort();
    const onClose = () => {
      if (!response.writableEnded) abort();
    };
    request.once("aborted", abort);
    response.once("close", onClose);
    if (request.aborted || response.destroyed) abort();

    const write = async (event: OptimizeStreamEvent) => {
      controller.signal.throwIfAborted();
      if (!response.headersSent) {
        response.set({
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-store, no-transform",
          "X-Accel-Buffering": "no",
        });
        response.flushHeaders();
      }
      if (!response.write(`${JSON.stringify(event)}\n`)) {
        await once(response, "drain", { signal: controller.signal });
      }
    };

    try {
      const result = await streamRewriteWithGroq(
        input,
        config(),
        (text) => write({ type: "delta", text }),
        controller.signal,
        dependencies,
      );
      await write({ type: "complete", result });
      response.end();
    } catch (error) {
      if (controller.signal.aborted || response.destroyed) return;
      if (!response.headersSent) throw error;
      await write({
        type: "error",
        error:
          error instanceof GroqError
            ? error.message
            : "The rewrite could not be completed. Please try again.",
      });
      response.end();
    } finally {
      request.off("aborted", abort);
      response.off("close", onClose);
    }
  });

  app.use("/api", (_request, response) => {
    response.status(404).json({ error: "API route not found." });
  });

  if (process.env.NODE_ENV === "production") {
    const webDist = fileURLToPath(new URL("../../web/dist/", import.meta.url));
    app.use(express.static(webDist));
    // Express 5 requires a named wildcard; braces include the root route.
    app.get("/{*path}", (_request, response, next) => {
      if (!existsSync(join(webDist, "index.html"))) {
        response.status(503).json({ error: "Frontend build is missing. Run npm run build first." });
        return;
      }
      response.sendFile(join(webDist, "index.html"), (error) => {
        if (error) next(error);
      });
    });
  }

  const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, next) => {
    if (response.destroyed) return;
    if (response.headersSent) {
      next(error);
      return;
    }
    if (error instanceof RequestValidationError) {
      response.status(400).json({ error: error.message });
      return;
    }
    if (error instanceof GroqError) {
      response.status(error.status).json({ error: error.message });
      return;
    }
    const bodyError = error as { type?: string };
    if (bodyError?.type === "entity.too.large") {
      response
        .status(413)
        .json({ error: "Request is too large. Send a JSON body smaller than 32 KB." });
      return;
    }
    if (bodyError?.type === "entity.parse.failed") {
      response.status(400).json({ error: "Invalid JSON. Check the request body and try again." });
      return;
    }
    console.error("Unexpected API error while processing a request.");
    response.status(500).json({ error: "The request could not be processed. Please try again." });
  };
  app.use(errorHandler);
  return app;
}

export const app = createApp();
