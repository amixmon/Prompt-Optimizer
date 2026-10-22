import { BookOpen, Code2, FileText } from "lucide-react";

export interface PromptSuggestionsProps {
  onSuggestion: (prompt: string) => void;
}

const suggestions = [
  {
    icon: FileText,
    title: "Write a better email",
    prompt: "write an email to my professor asking for a deadline extension",
  },
  {
    icon: BookOpen,
    title: "Explain a tricky topic",
    prompt: "explain recursion to a beginner",
  },
  {
    icon: Code2,
    title: "Build something useful",
    prompt: "write a python function to remove duplicates from a list",
  },
];

export function Welcome() {
  return (
    <section className="welcome" aria-labelledby="welcome-title">
      <h1 id="welcome-title">
        What would you like to improve<span>?</span>
      </h1>
      <p className="welcome-description">A clearer prompt starts with your idea.</p>
    </section>
  );
}

export function PromptSuggestions({ onSuggestion }: PromptSuggestionsProps) {
  return (
    <div className="prompt-suggestions" aria-label="Try a prompt">
      {suggestions.map(({ icon: Icon, title, prompt }) => (
        <button className="suggestion-chip" key={title} onClick={() => onSuggestion(prompt)}>
          <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
          <span>{title}</span>
        </button>
      ))}
    </div>
  );
}
