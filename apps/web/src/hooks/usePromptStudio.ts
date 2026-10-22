import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_OPTIONS,
  type AiConfig,
  type ConnectionStatus,
  type PromptSession,
  type TechniqueId,
} from "@prompt-studio/shared";
import { getAiConfig } from "../lib/api";
import { streamOptimizePrompt } from "../lib/optimizeStream";
import { getInitialTheme, readSessions, saveSessions } from "../lib/storage";

export function usePromptStudio() {
  const [sessions, setSessions] = useState(readSessions);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [value, setDraftValue] = useState("");
  const draftRevision = useRef(0);
  const setValue = useCallback((next: string) => {
    draftRevision.current += 1;
    setDraftValue(next);
  }, []);
  const [technique, setTechnique] = useState<TechniqueId>("structured");
  const [options, setOptions] = useState({ ...DEFAULT_OPTIONS });
  const [isLoading, setIsLoading] = useState(false);
  const [pendingResponse, setPendingResponse] = useState<{ prompt: string; text: string } | null>(
    null,
  );
  const [latestResponseId, setLatestResponseId] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [theme, setTheme] = useState(getInitialTheme);
  const [storageWarning, setStorageWarning] = useState(false);
  const [aiConfig, setAiConfig] = useState<AiConfig | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("loading");
  const requestRef = useRef<AbortController | null>(null);
  const configRef = useRef<AbortController | null>(null);
  const activeSession = sessions.find((session) => session.id === activeId) ?? null;

  const refreshAiConfig = useCallback(async () => {
    configRef.current?.abort();
    const controller = new AbortController();
    configRef.current = controller;
    setConnectionStatus("loading");
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const config = await getAiConfig(controller.signal);
      if (configRef.current !== controller || controller.signal.aborted) return;
      setAiConfig(config);
      setConnectionStatus(config.configured ? "ready" : "needs-key");
    } catch {
      if (configRef.current === controller) {
        setAiConfig(null);
        setConnectionStatus("offline");
      }
    } finally {
      clearTimeout(timeout);
      if (configRef.current === controller) configRef.current = null;
    }
  }, []);

  useEffect(() => {
    void refreshAiConfig();
    return () => {
      configRef.current?.abort();
      configRef.current = null;
    };
  }, [refreshAiConfig]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try {
      localStorage.setItem("prompt-studio:theme", theme);
    } catch {
      /* Theme still works in memory. */
    }
  }, [theme]);

  useEffect(() => {
    setStorageWarning(!saveSessions(sessions));
  }, [sessions]);
  useEffect(() => () => requestRef.current?.abort(), []);

  const cancelPending = useCallback(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    setIsLoading(false);
    setPendingResponse(null);
    setLatestResponseId(null);
    setError(undefined);
  }, []);

  const newPrompt = useCallback(() => {
    cancelPending();
    setActiveId(null);
    setValue("");
    setOptions({ ...DEFAULT_OPTIONS });
    setTechnique("structured");
  }, [cancelPending, setValue]);

  function selectSession(id: string) {
    const session = sessions.find((item) => item.id === id);
    if (!session) return;
    cancelPending();
    setActiveId(id);
    setValue("");
    setOptions({ ...session.request.options });
    setTechnique(session.request.technique);
  }

  function deleteSession(id: string) {
    setSessions((previous) => previous.filter((session) => session.id !== id));
    if (activeId === id) newPrompt();
  }

  async function submit() {
    const prompt = value.trim();
    if (!prompt || requestRef.current || connectionStatus !== "ready") return;
    const controller = new AbortController();
    requestRef.current = controller;
    setIsLoading(true);
    setPendingResponse({ prompt, text: "" });
    setLatestResponseId(null);
    setError(undefined);
    const request = { prompt, technique, options: { ...options } };
    const submittedRevision = draftRevision.current;
    try {
      const result = await streamOptimizePrompt(request, controller.signal, (text) => {
        if (controller.signal.aborted || requestRef.current !== controller) return;
        setPendingResponse((previous) =>
          previous ? { ...previous, text: previous.text + text } : previous,
        );
      });
      if (controller.signal.aborted) return;
      const session: PromptSession = {
        id: result.id,
        title: prompt.length > 54 ? `${prompt.slice(0, 54)}…` : prompt,
        createdAt: new Date().toISOString(),
        request,
        result,
      };
      setSessions((previous) => [session, ...previous].slice(0, 30));
      setActiveId(session.id);
      setLatestResponseId(session.id);
      if (draftRevision.current === submittedRevision) setValue("");
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(
          cause instanceof Error && cause.message !== "Failed to fetch"
            ? cause.message
            : "Cannot reach the optimizer. Make sure the backend is running and try again.",
        );
      }
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setIsLoading(false);
        setPendingResponse(null);
      }
    }
  }

  return {
    sessions,
    activeId,
    activeSession,
    value,
    setValue,
    technique,
    setTechnique,
    options,
    setOptions,
    isLoading,
    pendingResponse,
    latestResponseId,
    error,
    theme,
    storageWarning,
    aiConfig,
    connectionStatus,
    refreshAiConfig,
    toggleTheme: () => setTheme((current) => (current === "light" ? "dark" : "light")),
    newPrompt,
    selectSession,
    deleteSession,
    submit,
  };
}
