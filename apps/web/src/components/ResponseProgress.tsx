import { PromptMarkdown } from "./PromptMarkdown";

export interface ResponseProgressProps {
  prompt: string;
  text: string;
}

export function ResponseProgress({ prompt, text }: ResponseProgressProps) {
  const hasText = text.trim().length > 0;

  return (
    <section className="result-view" aria-label="Prompt optimization in progress">
      <div className="user-message">
        <div>{prompt}</div>
      </div>
      <div className="assistant-response response-enter">
        <h1 className="result-title" id="streaming-prompt-title">
          Optimizing prompt
        </h1>
        <div className={hasText ? "sr-only" : "response-progress"} role="status" aria-live="polite">
          <span>{hasText ? "Writing your optimized prompt…" : "Refining your prompt…"}</span>
          {!hasText && (
            <span className="response-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          )}
        </div>
        {hasText && (
          <div
            className="optimized-card response-streaming"
            aria-labelledby="streaming-prompt-title"
          >
            <PromptMarkdown text={text} />
            <span className="response-cursor" aria-hidden="true" />
          </div>
        )}
      </div>
    </section>
  );
}
