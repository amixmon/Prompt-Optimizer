import { TECHNIQUES, type OptimizeRequest } from "@prompt-studio/shared";

export class RequestValidationError extends Error {}

const LIMITS = {
  prompt: 8_000,
  audience: 120,
  length: 80,
  context: 2_000,
  example: 2_000,
} as const;

const FORMATS = ["auto", "bullet-points", "paragraph", "numbered-list"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertKeys(value: Record<string, unknown>, allowed: string[], name: string) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new RequestValidationError(`${name} contains an unsupported field.`);
  }
}

function assertText(value: unknown, name: string, max: number, required: boolean) {
  if (typeof value !== "string") {
    throw new RequestValidationError(`${name} must be a string.`);
  }
  if (required && !value.trim()) {
    throw new RequestValidationError(`${name} is required.`);
  }
  if (value.length > max) {
    throw new RequestValidationError(`${name} must be no more than ${max} characters.`);
  }
}

export function validateRequest(body: unknown): OptimizeRequest {
  if (!isRecord(body)) {
    throw new RequestValidationError("Send a JSON object with prompt, technique, and options.");
  }
  assertKeys(body, ["prompt", "technique", "options"], "Request");
  assertText(body.prompt, "Prompt", LIMITS.prompt, true);

  if (!TECHNIQUES.some(({ id }) => id === body.technique)) {
    throw new RequestValidationError(
      "Choose a supported technique: structured, few-shot, or role-based.",
    );
  }
  if (!isRecord(body.options)) {
    throw new RequestValidationError("Options must be a JSON object.");
  }
  assertKeys(body.options, ["audience", "length", "format", "context", "example"], "Options");
  assertText(body.options.audience, "Audience", LIMITS.audience, false);
  assertText(body.options.length, "Length", LIMITS.length, false);
  assertText(body.options.context, "Context", LIMITS.context, false);
  assertText(body.options.example, "Example", LIMITS.example, false);

  if (typeof body.options.format !== "string" || !FORMATS.includes(body.options.format)) {
    throw new RequestValidationError(
      "Choose a supported output format: auto, bullet-points, paragraph, or numbered-list.",
    );
  }

  return body as unknown as OptimizeRequest;
}
