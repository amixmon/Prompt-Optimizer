import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  TECHNIQUES,
  type OptimizeRequest,
  type OptimizeResponse,
  type PromptVariant,
  type TechniqueId,
} from "@prompt-studio/shared";
import { analyzePrompt } from "./analyze.js";

const FORMAT_INSTRUCTIONS = {
  "bullet-points": "Use bullet points.",
  paragraph: "Use a single paragraph.",
  "numbered-list": "Use a numbered list.",
} as const;

const INLINE_AUDIENCE =
  /\b(?:audience|readers?|beginners?|students?|children|kids?|experts?|executives?|non[- ]technical|professors?|teachers?|managers?|clients?|customers?|colleagues?)\b|\bfor (?:my |our |the |an? )?(?:team|boss|friend|parent|developer|professional)s?\b/i;
const INLINE_LENGTH =
  /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:words?|sentences?|paragraphs?|characters?|lines?|bullets?|points?)\b|\b(?:brief|concise|short|length|word limit|word count|maximum|minimum|at most|at least)\b/i;
const STRICT_OUTPUT =
  /\b(?:only (?:the )?code|code[- ]only|just (?:the )?code|no (?:explanations?|comments?|prose)|without (?:any )?(?:explanations?|comments?|prose)|do not (?:explain|include (?:any )?(?:explanations?|comments?))|nothing else|no additional text)\b/i;
const INLINE_FORMAT =
  /\b(?:bullet(?:[ -]points?)?|numbered[ -]list|paragraphs?|table|json|markdown|plain text|csv|yaml|xml|single sentence|one[- ]liner)\b/i;
const EXISTING_ROLE =
  /\b(?:you are|you're|act as|assume (?:the |a )?role|take (?:the |a )?role|pretend (?:to be|you are)|as an? (?:expert|editor|teacher|developer|writer|assistant|analyst))\b/i;
const CLEAR_LANGUAGE =
  /\b(?:clear|clearly|precise|precisely|concise|concisely|simple|simply|brief|briefly|straightforward|readable|plain language)\b/i;
const NO_EXAMPLES =
  /\b(?:no examples?|without (?:any )?examples?|(?:do not|don't|never) (?:include|add|use|give|provide) (?:any )?examples?)\b/i;

type Intent = "email" | "code" | "explain" | "summary" | "writing" | "general";

function detectIntent(prompt: string): Intent {
  if (
    /\b(?:debug|refactor|coding)\b|\b(?:write|create|build|implement|fix|optimi[sz]e)\b[\s\S]{0,80}\b(?:code|function|program|script|app|api|query|algorithm)\b/i.test(
      prompt,
    )
  )
    return "code";
  if (
    /\b(?:write|draft|compose|reply|send)\b[\s\S]{0,100}\b(?:e-?mail|letter|message)\b/i.test(
      prompt,
    )
  )
    return "email";
  if (/\b(?:explain|teach|describe|help me understand|walk me through)\b/i.test(prompt))
    return "explain";
  if (/\b(?:summari[sz](?:e|es|ing|ation)|summary|summaries|condense|abridge)\b/i.test(prompt))
    return "summary";
  if (/\b(?:write|draft|compose|rewrite|edit|proofread|story|blog|essay)\b/i.test(prompt))
    return "writing";
  if (/\b(?:code|python|javascript|typescript|sql|html|css)\b/i.test(prompt)) return "code";
  return "general";
}

const ROLES: Record<Intent, string> = {
  email: "Act as a professional writing assistant.",
  code: "Act as a software developer.",
  explain: "Act as a patient teacher.",
  summary: "Act as a careful editor.",
  writing: "Act as an editor.",
  general: "Act as a thoughtful assistant.",
};

function normalized(text: string) {
  return text.trim().replace(/\s+/gu, " ").toLowerCase();
}

function sentence(text: string) {
  return /[.!?]$/u.test(text) ? text : `${text}.`;
}

function refine(technique: TechniqueId, request: OptimizeRequest) {
  const original = request.prompt.trim();
  const options = request.options;
  const intent = detectIntent(original);
  const additions: string[] = [];
  const changes = ["Preserved your wording and existing instructions."];
  const strictOutput = STRICT_OUTPUT.test(original);
  let role = "";

  if (technique === "role-based") {
    if (EXISTING_ROLE.test(original)) {
      changes.push("Kept your existing role instead of adding another.");
    } else {
      role = ROLES[intent];
      changes.push("Added a role suited to the task words in your prompt.");
    }
  }

  const audience = options.audience.trim();
  if (audience) {
    if (INLINE_AUDIENCE.test(original) || normalized(original).includes(normalized(audience))) {
      changes.push("Kept the audience already indicated in your prompt.");
    } else {
      additions.push(sentence(`Tailor the response to ${audience}`));
      changes.push("Added your audience preference.");
    }
  }

  const length = options.length.trim();
  if (length) {
    if (INLINE_LENGTH.test(original) || normalized(original).includes(normalized(length))) {
      changes.push("Kept your original length instruction instead of overriding it.");
    } else {
      additions.push(sentence(`Follow this length preference: ${length}`));
      changes.push("Added your length preference.");
    }
  }

  if (options.format !== "auto") {
    if (INLINE_FORMAT.test(original) || strictOutput) {
      changes.push("Kept your original output instructions instead of imposing a format.");
    } else {
      additions.push(FORMAT_INSTRUCTIONS[options.format]);
      changes.push("Added your selected output format.");
    }
  }

  const context = options.context.trim();
  if (context && !normalized(original).includes(normalized(context))) {
    additions.push(sentence(`Consider this context: ${context}`));
    changes.push("Included your supplied context.");
  }

  if (!CLEAR_LANGUAGE.test([original, ...additions].join(" ")) && !strictOutput) {
    additions.push(intent === "code" ? "Use readable names." : "Use clear, precise language.");
    changes.push(
      intent === "code"
        ? "Added a brief readability instruction."
        : "Added a brief clarity instruction.",
    );
  }

  if (technique === "few-shot") {
    const example = options.example.trim();
    if (!example) {
      changes.push("Add an optional output example to use few-shot prompting; none was invented.");
    } else if (NO_EXAMPLES.test(original)) {
      changes.push("Kept your no-examples instruction; the optional example was not added.");
    } else if (normalized(original).includes(normalized(example))) {
      changes.push("Kept the example already present in your prompt.");
    } else {
      additions.push(`Example output: ${example}`);
      changes.push("Included your supplied output example without inventing an example input.");
    }
  }

  // Separate additions so a closing code fence, URL, or other exact syntax is
  // preserved; never attach punctuation to the user's original text.
  const body = additions.length ? `${original}\n\n${additions.join(" ")}` : original;
  return { prompt: role ? `${role} ${body}` : body, changes };
}

export function optimizePrompt(request: OptimizeRequest): OptimizeResponse {
  const startedAt = performance.now();
  const variants: PromptVariant[] = TECHNIQUES.map(({ id, label }) => {
    const { prompt, changes } = refine(id, request);
    return {
      technique: id,
      title: `${label} prompt`,
      prompt,
      analysis: analyzePrompt(prompt),
      changes,
    };
  });

  return {
    id: randomUUID(),
    original: { prompt: request.prompt, analysis: analyzePrompt(request.prompt) },
    variants,
    selectedTechnique: request.technique,
    elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
  };
}
