import type { AnalysisCheck, PromptAnalysis } from "@prompt-studio/shared";

// These checks look for text signals only. They do not measure model output or
// whether an instruction is correct, appropriate, or likely to improve results.
const RULES = [
  {
    id: "task",
    label: "Clear task",
    pattern:
      /\b(?:write|draft|compose|create|build|implement|debug|fix|refactor|explain|teach|describe|compare|analy[sz]e|translate|plan|list|design|review|rewrite|edit|proofread|summari[sz](?:e|es|ing|ation)|summary|summaries|condense|abridge)\b/i,
    detail:
      "Looks for a task verb such as write, explain, build, compare, or summarize; it does not verify intent.",
  },
  {
    id: "audience",
    label: "Defined audience",
    pattern:
      /\b(?:audience|readers?|beginners?|students?|children|experts?|executives?|professors?|teachers?|clients?|general public|non[- ]technical)\b/i,
    detail: "Looks for an audience label or a reader cue such as beginners or students.",
  },
  {
    id: "length",
    label: "Length guidance",
    pattern:
      /\b(?:\d+\s*(?:words?|sentences?|paragraphs?|bullets?|characters?|lines?)|(?:length|length preference|word limit|word count)\s*:\s*\S|brief|concise|short)\b/i,
    detail:
      "Looks for a numeric length, a length field, or a cue such as concise; it does not validate the requested limit.",
  },
  {
    id: "format",
    label: "Output format",
    pattern:
      /\b(?:bullet(?:[ -]points?)?|numbered[ -]list|paragraphs?|table|json|markdown|plain text|csv|yaml|code[- ]only|only (?:the )?code|output format)\b/i,
    detail:
      "Looks for a format cue such as bullet points, paragraph, JSON, or code only; it does not verify compatibility.",
  },
  {
    id: "context",
    label: "Source or context",
    pattern:
      /\b(?:context|source text|input text|text to summari[sz]e|article|passage|document)\b/i,
    detail:
      "Looks for a source-text or context cue; it does not verify that enough relevant context was supplied.",
  },
] as const;

export function analyzePrompt(prompt: string): PromptAnalysis {
  const checks: AnalysisCheck[] = RULES.map(({ id, label, pattern, detail }) => ({
    id,
    label,
    passed: pattern.test(prompt),
    detail,
  }));

  return {
    score: checks.filter(({ passed }) => passed).length * 20,
    wordCount: prompt.trim() ? prompt.trim().split(/\s+/u).length : 0,
    checks,
  };
}
