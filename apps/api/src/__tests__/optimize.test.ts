import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_OPTIONS, type OptimizeRequest } from "@prompt-studio/shared";
import { analyzePrompt } from "../lib/analyze.js";
import { optimizePrompt } from "../lib/optimize.js";

function request(overrides: Partial<OptimizeRequest> = {}): OptimizeRequest {
  return {
    prompt: "  Help with this request.\nKeep the original punctuation!  ",
    technique: "structured",
    options: { ...DEFAULT_OPTIONS },
    ...overrides,
  };
}

function wordCount(text: string) {
  return text.trim().split(/\s+/u).length;
}

test("completeness checks general task words with transparent equal weights", () => {
  const empty = analyzePrompt("Help me with this.");
  assert.equal(empty.score, 0);
  assert.equal(empty.wordCount, 4);
  assert.equal(empty.checks.length, 5);
  assert.ok(empty.checks.every(({ passed, detail }) => !passed && detail.length > 20));

  const complete = analyzePrompt(
    "Explain the source text for students in 100 words using bullet points.",
  );
  assert.equal(complete.score, 100);
  assert.equal(complete.score, complete.checks.filter(({ passed }) => passed).length * 20);
  assert.equal(analyzePrompt("Write an email.").checks[0].passed, true);
  assert.equal(analyzePrompt("Build a function.").checks[0].passed, true);
  assert.equal(analyzePrompt("").wordCount, 0);
});

test("variants preserve user text, remain compact, and score actual text without forced completeness", () => {
  const input = request();
  const result = optimizePrompt(input);
  assert.equal(result.original.prompt, input.prompt);
  assert.deepEqual(result.original.analysis, analyzePrompt(input.prompt));
  assert.equal(result.selectedTechnique, "structured");
  assert.equal(result.variants.length, 3);
  assert.ok(result.elapsedMs >= 0);

  for (const variant of result.variants) {
    assert.ok(variant.prompt.includes(input.prompt.trim()));
    assert.deepEqual(variant.analysis, analyzePrompt(variant.prompt));
    assert.ok(wordCount(variant.prompt) <= wordCount(input.prompt) + 50);
    assert.ok(variant.analysis.score < 100);
    assert.doesNotMatch(
      variant.prompt,
      /summari[sz]|source text|<\/?original_request>|Task:|Role:|library|150 words/i,
    );
  }
});

test("email, explanation, and coding prompts retain their task and receive suitable optional roles", () => {
  const cases = [
    ["write an email to my professor asking for extension", "professional writing assistant"],
    ["explain recursion", "patient teacher"],
    ["write a Python function to sort a list", "software developer"],
  ];
  for (const [prompt, role] of cases) {
    const result = optimizePrompt(request({ prompt }));
    for (const variant of result.variants) {
      assert.ok(variant.prompt.includes(prompt));
      assert.doesNotMatch(
        variant.prompt,
        /summari[sz]|source text|Example input:|<original_request>/i,
      );
    }
    const roleVariant = result.variants.find(({ technique }) => technique === "role-based")!;
    assert.ok(roleVariant.prompt.startsWith(`Act as a ${role}.`));
  }
});

test("few-shot without a supplied example invents none and reports that limitation", () => {
  const result = optimizePrompt(request({ prompt: "Explain recursion." }));
  const structured = result.variants.find(({ technique }) => technique === "structured")!;
  const fewShot = result.variants.find(({ technique }) => technique === "few-shot")!;
  assert.equal(fewShot.prompt, structured.prompt);
  assert.doesNotMatch(fewShot.prompt, /example|library|input:|output:/i);
  assert.ok(fewShot.changes.some((change) => change.includes("none was invented")));
});

test("few-shot includes only the actual supplied output example and context", () => {
  const input = request({
    prompt: "Explain recursion.",
    technique: "few-shot",
    options: {
      ...DEFAULT_OPTIONS,
      format: "numbered-list",
      context: "This is for a programming workshop.",
      example: "1. A function calls itself until it reaches a base case.",
    },
  });
  const result = optimizePrompt(input);
  const fewShot = result.variants.find(({ technique }) => technique === "few-shot")!;
  assert.ok(fewShot.prompt.includes(`Example output: ${input.options.example}`));
  assert.ok(fewShot.prompt.includes(input.options.context));
  assert.match(fewShot.prompt, /Use a numbered list/);
  assert.doesNotMatch(fewShot.prompt, /Example input:|library|source text/i);
  assert.equal(result.selectedTechnique, "few-shot");
});

test("inline audience, length, and format constraints take precedence without duplicates", () => {
  const input = request({
    prompt:
      "Explain recursion for beginners in 50 words using bullet points. Be concise and clear.",
    options: { ...DEFAULT_OPTIONS, audience: "Experts", length: "100 words", format: "paragraph" },
  });
  for (const variant of optimizePrompt(input).variants) {
    assert.ok(variant.prompt.includes(input.prompt));
    assert.doesNotMatch(
      variant.prompt,
      /Experts|100 words|single paragraph|Use clear, precise language/,
    );
    assert.equal(variant.prompt.match(/50 words/g)?.length, 1);
    assert.equal(variant.prompt.match(/bullet points/g)?.length, 1);
  }
});

test("code-only and no-explanation instructions block conflicting prose formats and filler", () => {
  const input = request({
    prompt: "Write a Python function to add two numbers. Code only, no explanation.",
    options: { ...DEFAULT_OPTIONS, format: "paragraph" },
  });
  for (const variant of optimizePrompt(input).variants) {
    assert.ok(variant.prompt.includes(input.prompt));
    assert.doesNotMatch(
      variant.prompt,
      /single paragraph|clear, precise|readable names|source text|example output/i,
    );
  }
  assert.equal(optimizePrompt(input).variants[0].prompt, input.prompt);
});

test("existing roles, context, and examples are not duplicated", () => {
  const prompt =
    "Act as a patient teacher. Clearly explain recursion. Context: A beginner class. Example output: A function calls itself.";
  const input = request({
    prompt,
    options: {
      ...DEFAULT_OPTIONS,
      context: "A beginner class.",
      example: "A function calls itself.",
    },
  });
  for (const variant of optimizePrompt(input).variants) {
    assert.equal(variant.prompt, prompt);
  }
});

test("a no-examples instruction takes precedence over an optional example", () => {
  const result = optimizePrompt(
    request({
      prompt: "Clearly explain recursion without examples.",
      options: { ...DEFAULT_OPTIONS, example: "A fictional sample answer." },
    }),
  );
  const fewShot = result.variants.find(({ technique }) => technique === "few-shot")!;
  assert.equal(fewShot.prompt, "Clearly explain recursion without examples.");
  assert.ok(fewShot.changes.some((change) => change.includes("no-examples instruction")));
});

test("explicit optional preferences are added once while automatic defaults add no constraints", () => {
  const prompt = "Explain recursion.";
  const defaults = optimizePrompt(request({ prompt })).variants[0].prompt;
  assert.equal(defaults, "Explain recursion.\n\nUse clear, precise language.");

  const customized = optimizePrompt(
    request({
      prompt,
      options: {
        ...DEFAULT_OPTIONS,
        audience: "students",
        length: "80 words",
        format: "bullet-points",
      },
    }),
  ).variants[0].prompt;
  assert.match(customized, /Tailor the response to students/);
  assert.match(customized, /length preference: 80 words/);
  assert.match(customized, /Use bullet points/);
});

test("refinement is deterministic across repeated runs", () => {
  const first = optimizePrompt(request());
  const second = optimizePrompt(request());
  assert.deepEqual(first.variants, second.variants);
  assert.notEqual(first.id, second.id);
});

test("trailing code fences and URLs remain unchanged when instructions are added", () => {
  const prompts = [
    "Refactor this function:\n```python\ndef add(a, b):\n    return a + b\n```",
    "Explain this article: https://example.test/article",
  ];
  for (const prompt of prompts) {
    const structured = optimizePrompt(request({ prompt })).variants[0];
    assert.ok(structured.prompt.startsWith(`${prompt}\n\n`));
    assert.doesNotMatch(structured.prompt, /```\.|https:\/\/example\.test\/article\./);
  }
});
