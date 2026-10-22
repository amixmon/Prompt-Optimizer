import { useEffect, useRef, useState } from "react";
import {
  AiConnectionNotice,
  Composer,
  Header,
  OptionsPanel,
  ResultView,
  ResponseProgress,
  Sidebar,
  PromptSuggestions,
  Welcome,
} from "./components";
import { usePromptStudio } from "./hooks/usePromptStudio";

export default function App() {
  const studio = usePromptStudio();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const followResponse = useRef(true);
  const hasConversation = Boolean(studio.activeSession || studio.pendingResponse);

  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 860px)");
    const closeMobileNavigation = () => {
      if (!mobile.matches) setSidebarOpen(false);
    };
    mobile.addEventListener("change", closeMobileNavigation);
    return () => mobile.removeEventListener("change", closeMobileNavigation);
  }, []);

  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    const isNewResult = studio.activeId !== null && studio.activeId === studio.latestResponseId;
    if (isNewResult) {
      if (followResponse.current) {
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: "instant" });
      }
    } else {
      followResponse.current = true;
      viewport.scrollTo({ top: 0, behavior: "instant" });
    }
  }, [studio.activeId, studio.pendingResponse?.prompt, studio.latestResponseId]);

  useEffect(() => {
    const viewport = scrollRef.current;
    if (viewport && studio.pendingResponse && followResponse.current) {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: "instant" });
    }
  }, [studio.pendingResponse?.text]);

  function focusComposer() {
    requestAnimationFrame(() =>
      document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus(),
    );
  }

  function newPrompt() {
    studio.newPrompt();
    setSidebarOpen(false);
    setOptionsOpen(false);
    focusComposer();
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#prompt-input">
        Skip to prompt
      </a>
      <Sidebar
        sessions={studio.sessions}
        activeId={studio.activeId}
        onNew={newPrompt}
        onSelect={(id) => {
          studio.selectSession(id);
          setSidebarOpen(false);
          setOptionsOpen(false);
        }}
        onDelete={studio.deleteSession}
        isOpen={sidebarOpen}
        isCollapsed={sidebarCollapsed}
        onCollapse={() => {
          setSidebarCollapsed(true);
          requestAnimationFrame(() => document.getElementById("sidebar-toggle")?.focus());
        }}
        onClose={() => setSidebarOpen(false)}
      />
      <main className="workspace" inert={sidebarOpen}>
        <Header
          onToggleSidebar={() => {
            if (window.matchMedia("(max-width: 860px)").matches) {
              setSidebarOpen((open) => !open);
            } else {
              setSidebarCollapsed((collapsed) => !collapsed);
            }
          }}
          sidebarExpanded={!sidebarCollapsed}
          mobileSidebarExpanded={sidebarOpen}
          onNew={newPrompt}
          theme={studio.theme}
          onToggleTheme={studio.toggleTheme}
        />
        <div className={`workspace-body ${hasConversation ? "has-result" : "is-empty"}`}>
          <div
            className="conversation-scroll"
            ref={scrollRef}
            onScroll={(event) => {
              const viewport = event.currentTarget;
              followResponse.current =
                viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 80;
            }}
          >
            <div className="conversation-content">
              {studio.pendingResponse ? (
                <ResponseProgress
                  prompt={studio.pendingResponse.prompt}
                  text={studio.pendingResponse.text}
                />
              ) : studio.activeSession ? (
                <ResultView
                  key={studio.activeSession.id}
                  result={studio.activeSession.result}
                  selectedTechnique={studio.technique}
                  onTechniqueChange={studio.setTechnique}
                  originalPrompt={studio.activeSession.request.prompt}
                  onReuse={(prompt) => {
                    studio.setValue(prompt);
                    focusComposer();
                  }}
                />
              ) : (
                <Welcome />
              )}
            </div>
          </div>
          <div className="composer-dock">
            <AiConnectionNotice
              status={studio.connectionStatus}
              model={studio.aiConfig?.model}
              onRetry={() => void studio.refreshAiConfig()}
            />
            {optionsOpen && (
              <OptionsPanel
                options={studio.options}
                onChange={studio.setOptions}
                onClose={() => {
                  setOptionsOpen(false);
                  requestAnimationFrame(() =>
                    document.querySelector<HTMLButtonElement>(".options-toggle")?.focus(),
                  );
                }}
              />
            )}
            {studio.storageWarning && (
              <p className="storage-warning" role="status">
                Browser storage is unavailable. This session will stay open until you leave the
                page.
              </p>
            )}
            <Composer
              value={studio.value}
              onChange={studio.setValue}
              onSubmit={() => void studio.submit()}
              isLoading={studio.isLoading}
              technique={studio.technique}
              onTechniqueChange={studio.setTechnique}
              onToggleOptions={() => setOptionsOpen((open) => !open)}
              optionsOpen={optionsOpen}
              error={studio.error}
              disabled={studio.connectionStatus !== "ready"}
            />
          </div>
          {!hasConversation && (
            <PromptSuggestions
              onSuggestion={(prompt) => {
                studio.setValue(prompt);
                focusComposer();
              }}
            />
          )}
        </div>
      </main>
    </div>
  );
}
