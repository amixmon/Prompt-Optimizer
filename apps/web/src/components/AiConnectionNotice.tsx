import { LoaderCircle } from "lucide-react";
import type { ConnectionStatus } from "@prompt-studio/shared";

export interface AiConnectionNoticeProps {
  status: ConnectionStatus;
  model?: string;
  onRetry: () => void;
}

export function AiConnectionNotice({ status, onRetry }: AiConnectionNoticeProps) {
  if (status === "ready") return null;

  if (status === "loading") {
    return (
      <div className="ai-connection-loading" role="status" aria-live="polite">
        <LoaderCircle size={17} className="spinning" />
        <span>Checking AI setup…</span>
      </div>
    );
  }

  const needsKey = status === "needs-key";

  return (
    <section className="ai-connection-notice" aria-labelledby="ai-connection-title" role="status">
      <h2 id="ai-connection-title">{needsKey ? "Connect free AI" : "Cannot reach the server"}</h2>
      <p>
        {needsKey
          ? "Add your Groq API key on the server to enable prompt rewrites."
          : "Start the backend and check your connection, then try again."}
      </p>
      <div className="ai-connection-actions">
        {needsKey && (
          <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer">
            Get a free API key
          </a>
        )}
        <button type="button" onClick={onRetry}>
          {needsKey ? "Refresh setup" : "Retry"}
        </button>
      </div>
    </section>
  );
}
