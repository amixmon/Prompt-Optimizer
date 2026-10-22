import type { AiConfig, ApiError, OptimizeRequest, OptimizeResponse } from "@prompt-studio/shared";

export async function getAiConfig(signal: AbortSignal): Promise<AiConfig> {
  const response = await fetch("/api/config", { signal, cache: "no-store" });
  if (!response.ok) throw new Error("AI setup is unavailable.");
  const config: unknown = await response.json();
  if (
    !config ||
    typeof config !== "object" ||
    typeof (config as AiConfig).configured !== "boolean" ||
    (config as AiConfig).provider !== "groq" ||
    typeof (config as AiConfig).model !== "string"
  ) {
    throw new Error("AI setup is unavailable.");
  }
  return config as AiConfig;
}

export async function optimizePrompt(
  request: OptimizeRequest,
  signal: AbortSignal,
): Promise<OptimizeResponse> {
  const response = await fetch("/api/optimize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  const body: OptimizeResponse | ApiError = await response.json();
  if (!response.ok || "error" in body) {
    throw new Error(
      "error" in body ? body.error : "The prompt could not be optimized. Please try again.",
    );
  }
  return body;
}
