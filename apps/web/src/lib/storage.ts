import type { PromptSession } from "@prompt-studio/shared";

const HISTORY_KEY = "prompt-studio:sessions:v1";
const MAX_SESSIONS = 30;
const MAX_STORAGE_SIZE = 3_000_000;

function isSession(value: unknown): value is PromptSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<PromptSession>;
  return (
    typeof session.id === "string" &&
    typeof session.title === "string" &&
    typeof session.createdAt === "string" &&
    typeof session.request?.prompt === "string" &&
    !!session.request.options &&
    typeof session.request.options.audience === "string" &&
    typeof session.request.options.length === "string" &&
    typeof session.request.options.context === "string" &&
    typeof session.request.options.example === "string" &&
    ["auto", "bullet-points", "paragraph", "numbered-list"].includes(
      session.request.options.format,
    ) &&
    ["structured", "few-shot", "role-based"].includes(session.request.technique) &&
    typeof session.result?.original?.prompt === "string" &&
    (session.result.generation === undefined ||
      (session.result.generation !== null &&
        typeof session.result.generation === "object" &&
        session.result.generation.provider === "groq" &&
        typeof session.result.generation.model === "string")) &&
    isAnalysis(session.result.original.analysis) &&
    Array.isArray(session.result.variants) &&
    session.result.variants.length >= 1 &&
    session.result.variants.length <= 3 &&
    session.result.variants.every(
      (variant) =>
        variant !== null &&
        typeof variant === "object" &&
        typeof variant.prompt === "string" &&
        typeof variant.title === "string" &&
        ["structured", "few-shot", "role-based"].includes(variant.technique) &&
        Array.isArray(variant.changes) &&
        variant.changes.every((change) => typeof change === "string") &&
        isAnalysis(variant.analysis),
    )
  );
}

function isAnalysis(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const analysis = value as { score?: unknown; wordCount?: unknown; checks?: unknown };
  return (
    typeof analysis.score === "number" &&
    Number.isFinite(analysis.score) &&
    typeof analysis.wordCount === "number" &&
    Number.isFinite(analysis.wordCount) &&
    Array.isArray(analysis.checks) &&
    analysis.checks.every((check: unknown) => {
      if (!check || typeof check !== "object") return false;
      const item = check as Record<string, unknown>;
      return (
        typeof item.id === "string" &&
        typeof item.label === "string" &&
        typeof item.detail === "string" &&
        typeof item.passed === "boolean"
      );
    })
  );
}

export function readSessions(): PromptSession[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw || raw.length > MAX_STORAGE_SIZE) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isSession).slice(0, MAX_SESSIONS) : [];
  } catch {
    return [];
  }
}

export function saveSessions(sessions: PromptSession[]): boolean {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(sessions.slice(0, MAX_SESSIONS)));
    return true;
  } catch {
    return false;
  }
}

export function getInitialTheme(): "light" | "dark" {
  try {
    return localStorage.getItem("prompt-studio:theme") === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}
