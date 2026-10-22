export const TECHNIQUES = [
  {
    id: "structured",
    label: "Structured",
    description: "Clear instructions, context, and an output format.",
  },
  {
    id: "few-shot",
    label: "Few-shot",
    description: "An example you provide to demonstrate the expected output.",
  },
  {
    id: "role-based",
    label: "Role-based",
    description: "A relevant role to give your task a clear perspective.",
  },
] as const;

export type TechniqueId = (typeof TECHNIQUES)[number]["id"];
export type OutputFormat = "auto" | "bullet-points" | "paragraph" | "numbered-list";

export interface PromptOptions {
  audience: string;
  length: string;
  format: OutputFormat;
  context: string;
  example: string;
}

export const DEFAULT_OPTIONS: PromptOptions = {
  audience: "",
  length: "",
  format: "auto",
  context: "",
  example: "",
};

export interface OptimizeRequest {
  prompt: string;
  technique: TechniqueId;
  options: PromptOptions;
}

export interface AnalysisCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface PromptAnalysis {
  score: number;
  wordCount: number;
  checks: AnalysisCheck[];
}

export interface PromptVariant {
  technique: TechniqueId;
  title: string;
  prompt: string;
  analysis: PromptAnalysis;
  changes: string[];
}

export interface OptimizeResponse {
  id: string;
  original: { prompt: string; analysis: PromptAnalysis };
  variants: PromptVariant[];
  selectedTechnique: TechniqueId;
  elapsedMs: number;
  generation?: { provider: "groq"; model: string };
}

export type OptimizeStreamEvent =
  | { type: "delta"; text: string }
  | { type: "complete"; result: OptimizeResponse }
  | { type: "error"; error: string };

export interface AiConfig {
  configured: boolean;
  provider: "groq";
  model: string;
}

export type ConnectionStatus = "loading" | "ready" | "needs-key" | "offline";

export interface PromptSession {
  id: string;
  title: string;
  createdAt: string;
  request: OptimizeRequest;
  result: OptimizeResponse;
}

export interface ApiError {
  error: string;
}
