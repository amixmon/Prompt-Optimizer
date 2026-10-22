import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Copy, CornerDownLeft } from "lucide-react";
import { TECHNIQUES, type OptimizeResponse, type TechniqueId } from "@prompt-studio/shared";
import { PromptMarkdown } from "./PromptMarkdown";

export interface ResultViewProps {
  result: OptimizeResponse;
  selectedTechnique: TechniqueId;
  onTechniqueChange: (technique: TechniqueId) => void;
  originalPrompt: string;
  onReuse: (text: string) => void;
}

export function ResultView({
  result,
  selectedTechnique,
  onTechniqueChange,
  originalPrompt,
  onReuse,
}: ResultViewProps) {
  const [copiedPrompt, setCopiedPrompt] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const variant =
    result.variants.find((item) => item.technique === selectedTechnique) ?? result.variants[0];

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  if (!variant) return null;
  const copied = copiedPrompt === variant.prompt;
  const hasAlternatives = result.variants.length > 1;
  const techniqueLabel = TECHNIQUES.find((item) => item.id === variant.technique)?.label;

  async function copyPrompt() {
    if (!variant) return;
    let copiedSuccessfully = false;
    try {
      await navigator.clipboard.writeText(variant.prompt);
      copiedSuccessfully = true;
    } catch {
      const field = document.createElement("textarea");
      try {
        field.value = variant.prompt;
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.appendChild(field);
        field.select();
        copiedSuccessfully = document.execCommand("copy");
      } catch {
        copiedSuccessfully = false;
      } finally {
        field.remove();
      }
    }
    setCopyError(copiedSuccessfully ? null : variant.prompt);
    if (copiedSuccessfully) {
      if (copyTimer.current) clearTimeout(copyTimer.current);
      setCopiedPrompt(variant.prompt);
      copyTimer.current = setTimeout(() => setCopiedPrompt(null), 2200);
    }
  }

  return (
    <section className="result-view" aria-label="Prompt optimization results">
      <div className="user-message">
        <div>{originalPrompt}</div>
      </div>
      <div className="assistant-response">
        <h1 className="result-title" id="optimized-prompt-title">
          Optimized prompt
        </h1>
        {!result.generation && <p className="result-helper">Saved local-rule result</p>}
        <div className="optimized-card" aria-labelledby="optimized-prompt-title">
          <PromptMarkdown text={variant.prompt} />
          <div className="optimized-actions">
            <button className={`copy-button ${copied ? "is-copied" : ""}`} onClick={copyPrompt}>
              {copied ? <Check size={17} /> : <Copy size={17} />}
              <span>{copied ? "Copied" : "Copy prompt"}</span>
            </button>
            <button className="text-icon-button" onClick={() => onReuse(variant.prompt)}>
              <CornerDownLeft size={17} />
              <span>Use in composer</span>
            </button>
          </div>
          {copyError === variant.prompt && (
            <p className="copy-error" role="alert">
              Copy is unavailable. Select the prompt text to copy it.
            </p>
          )}
        </div>

        <details className="result-details">
          <summary>
            <span>{hasAlternatives ? "Compare techniques & details" : "Prompt details"}</span>
            <ChevronDown size={18} />
          </summary>
          <div className="result-details-content">
            <p className="result-helper">
              {result.generation
                ? `AI rewrite powered by Groq · ${result.generation.model}`
                : "Saved prompt refined with local rules."}
            </p>
            <dl className="prompt-metadata">
              <div>
                <dt>Technique</dt>
                <dd>{techniqueLabel}</dd>
              </div>
              <div>
                <dt>Original</dt>
                <dd>{result.original.analysis.wordCount} words</dd>
              </div>
              <div>
                <dt>Optimized</dt>
                <dd>{variant.analysis.wordCount} words</dd>
              </div>
            </dl>
            {hasAlternatives && (
              <div className="result-tabs" aria-label="Saved prompting techniques">
                {result.variants.map((item) => (
                  <button
                    key={item.technique}
                    aria-pressed={variant.technique === item.technique}
                    className={variant.technique === item.technique ? "is-active" : ""}
                    onClick={() => onTechniqueChange(item.technique)}
                  >
                    {TECHNIQUES.find((technique) => technique.id === item.technique)?.label}
                  </button>
                ))}
              </div>
            )}

            {hasAlternatives && (
              <div className="comparison-table-wrap">
                <table>
                  <caption className="sr-only">Original and refined prompt comparison</caption>
                  <thead>
                    <tr>
                      <th scope="col">Technique</th>
                      <th scope="col">Checklist score</th>
                      <th scope="col">Words</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th scope="row">Original</th>
                      <td>{result.original.analysis.score}%</td>
                      <td>{result.original.analysis.wordCount}</td>
                    </tr>
                    {result.variants.map((item) => (
                      <tr
                        key={item.technique}
                        className={item.technique === variant.technique ? "is-selected" : ""}
                      >
                        <th scope="row">
                          {TECHNIQUES.find((technique) => technique.id === item.technique)?.label}
                        </th>
                        <td>{item.analysis.score}%</td>
                        <td>{item.analysis.wordCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="result-helper">
              The instruction checklist uses simple text rules. It does not measure AI response
              quality.
            </p>

            <div className="result-detail-grid">
              <section className="changes-card" aria-labelledby="changes-title">
                <h2 id="changes-title">What changed</h2>
                <ul>
                  {variant.changes.map((change, index) => (
                    <li key={`${index}-${change}`}>{change}</li>
                  ))}
                </ul>
              </section>
              <section className="checklist-card" aria-labelledby="checklist-title">
                <h2 id="checklist-title">Instruction checklist</h2>
                <ul>
                  {variant.analysis.checks.map((check) => (
                    <li key={check.id}>
                      <span
                        className={`check-status ${check.passed ? "passed" : ""}`}
                        aria-label={check.passed ? "Included" : "Missing"}
                      >
                        {check.passed ? <Check size={14} /> : <span />}
                      </span>
                      <div>
                        <strong>{check.label}</strong>
                        <p>{check.detail}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </div>
        </details>
      </div>
    </section>
  );
}
