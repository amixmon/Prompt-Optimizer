import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  LoaderCircle,
  SlidersHorizontal,
  WandSparkles,
} from "lucide-react";
import { TECHNIQUES, type TechniqueId } from "@prompt-studio/shared";

export interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
  technique: TechniqueId;
  onTechniqueChange: (technique: TechniqueId) => void;
  onToggleOptions: () => void;
  optionsOpen: boolean;
  error?: string;
  disabled?: boolean;
}

export function Composer({
  value,
  onChange,
  onSubmit,
  isLoading,
  technique,
  onTechniqueChange,
  onToggleOptions,
  optionsOpen,
  error,
  disabled,
}: ComposerProps) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const techniqueButton = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const selected = TECHNIQUES.find((item) => item.id === technique)!;
  useEffect(() => {
    const field = textarea.current;
    if (field) {
      field.style.height = "auto";
      field.style.height = `${Math.min(field.scrollHeight, 200)}px`;
    }
  }, [value]);
  useEffect(() => {
    const field = textarea.current;
    if (!field) return;
    let previousWidth = 0;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry || entry.contentRect.width === previousWidth) return;
      previousWidth = entry.contentRect.width;
      field.style.height = "auto";
      field.style.height = `${Math.min(field.scrollHeight, 200)}px`;
    });
    observer.observe(field);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (!menu.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        techniqueButton.current?.focus();
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [menuOpen]);

  function submit() {
    if (value.trim() && !disabled && !isLoading) onSubmit();
  }

  return (
    <div className="composer-wrapper">
      {error && (
        <p className="composer-error" role="alert">
          {error}
        </p>
      )}
      <form
        className={`composer ${isLoading ? "is-loading" : ""}`}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="sr-only" htmlFor="prompt-input">
          Your prompt
        </label>
        <textarea
          id="prompt-input"
          ref={textarea}
          rows={1}
          maxLength={8000}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Paste or write a prompt to improve…"
          disabled={isLoading}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <div className="composer-toolbar">
          <div className="composer-tools">
            <div className="technique-picker" ref={menu}>
              <button
                className="technique-button"
                ref={techniqueButton}
                type="button"
                onClick={() => setMenuOpen(!menuOpen)}
                aria-expanded={menuOpen}
                aria-controls="technique-menu"
              >
                <WandSparkles size={18} aria-hidden="true" />
                <span>{selected.label}</span>
                <ChevronDown size={13} />
              </button>
              {menuOpen && (
                <div className="technique-menu" id="technique-menu">
                  <span className="menu-label">Optimization technique</span>
                  {TECHNIQUES.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => {
                        onTechniqueChange(item.id);
                        setMenuOpen(false);
                        techniqueButton.current?.focus();
                      }}
                      className={technique === item.id ? "is-selected" : ""}
                      aria-pressed={technique === item.id}
                    >
                      <span>
                        <strong>{item.label}</strong>
                        <small>{item.description}</small>
                      </span>
                      {technique === item.id && <Check size={16} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              className={`options-toggle ${optionsOpen ? "is-active" : ""}`}
              type="button"
              onClick={onToggleOptions}
              aria-expanded={optionsOpen}
              aria-controls="prompt-options"
              aria-haspopup="dialog"
            >
              <SlidersHorizontal size={18} aria-hidden="true" />
              <span>Customize</span>
            </button>
          </div>
          <div className="composer-send-group">
            {value.length > 7000 && <span className="character-count">{value.length}/8000</span>}
            <button
              className="send-button"
              type="submit"
              disabled={!value.trim() || isLoading || disabled}
              aria-label={isLoading ? "Optimizing prompt" : "Optimize prompt"}
              title="Optimize prompt"
            >
              {isLoading ? <LoaderCircle size={20} className="spinning" /> : <ArrowUp size={22} />}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
