import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { PromptOptions } from "@prompt-studio/shared";

export interface OptionsPanelProps {
  options: PromptOptions;
  onChange: (options: PromptOptions) => void;
  onClose: () => void;
}

export function OptionsPanel({ options, onChange, onClose }: OptionsPanelProps) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const panel = dialog.current;
    if (!panel) return;
    panel.showModal();
    return () => panel.close();
  }, []);

  function update<K extends keyof PromptOptions>(key: K, value: PromptOptions[K]) {
    onChange({ ...options, [key]: value });
  }
  return (
    <dialog
      ref={dialog}
      className="options-panel"
      id="prompt-options"
      aria-labelledby="options-title"
      aria-describedby="options-description"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        ) {
          onClose();
        }
      }}
    >
      <div className="options-heading">
        <div>
          <h2 id="options-title">Give it a little direction</h2>
          <p id="options-description">These details shape your optimized prompt.</p>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close customization">
          <X size={17} />
        </button>
      </div>
      <div className="options-grid">
        <label>
          Audience
          <input
            maxLength={120}
            value={options.audience}
            onChange={(event) => update("audience", event.target.value)}
            placeholder="Optional, e.g. first-year students"
          />
        </label>
        <label>
          Target length
          <input
            maxLength={80}
            value={options.length}
            onChange={(event) => update("length", event.target.value)}
            placeholder="Optional, e.g. under 150 words"
          />
        </label>
        <label>
          Output format
          <select
            value={options.format}
            onChange={(event) => update("format", event.target.value as PromptOptions["format"])}
          >
            <option value="auto">Keep original</option>
            <option value="bullet-points">Bullet points</option>
            <option value="paragraph">Paragraph</option>
            <option value="numbered-list">Numbered list</option>
          </select>
        </label>
      </div>
      <div className="options-detail-grid">
        <label>
          Extra context <span>optional</span>
          <textarea
            rows={2}
            maxLength={2000}
            value={options.context}
            onChange={(event) => update("context", event.target.value)}
            placeholder="Any details the AI should consider?"
          />
        </label>
        <label>
          Example output <span>for few-shot</span>
          <textarea
            rows={2}
            maxLength={2000}
            value={options.example}
            onChange={(event) => update("example", event.target.value)}
            placeholder="Add an example of the output you want"
          />
        </label>
      </div>
    </dialog>
  );
}
