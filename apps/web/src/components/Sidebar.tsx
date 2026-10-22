import { useEffect, useRef, useState } from "react";
import { PanelLeftClose, Search, SquarePen, Trash2, X } from "lucide-react";
import type { PromptSession } from "@prompt-studio/shared";

export interface SidebarProps {
  sessions: PromptSession[];
  activeId: string | null;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  isOpen: boolean;
  isCollapsed: boolean;
  onClose: () => void;
  onCollapse: () => void;
}

export function Sidebar({
  sessions,
  activeId,
  onNew,
  onSelect,
  onDelete,
  isOpen,
  isCollapsed,
  onClose,
  onCollapse,
}: SidebarProps) {
  const [search, setSearch] = useState("");
  const sidebarRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  const restoreFocusFrame = useRef<number | null>(null);
  const filtered = sessions.filter((session) =>
    session.title.toLowerCase().includes(search.toLowerCase()),
  );

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (isOpen && restoreFocusFrame.current !== null) {
      cancelAnimationFrame(restoreFocusFrame.current);
      restoreFocusFrame.current = null;
    }
    if (!isOpen || !window.matchMedia("(max-width: 860px)").matches) return;
    const sidebar = sidebarRef.current;
    const previousFocus =
      document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : document.getElementById("mobile-sidebar-toggle");
    const controls = () =>
      Array.from(
        sidebar?.querySelectorAll<HTMLElement>(
          "a[href], button:not([disabled]), input:not([disabled])",
        ) ?? [],
      ).filter(
        (element) =>
          element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden",
      );
    const initialFocusFrame = requestAnimationFrame(() => {
      sidebar?.querySelector<HTMLElement>(".sidebar-close")?.focus();
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key !== "Tab") return;
      const items = controls();
      const first = items[0];
      const last = items[items.length - 1];
      if (!sidebar?.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      cancelAnimationFrame(initialFocusFrame);
      restoreFocusFrame.current = requestAnimationFrame(() => {
        restoreFocusFrame.current = null;
        if (sidebar?.isConnected && sidebar.classList.contains("is-open")) return;
        if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
          previousFocus.focus();
      });
    };
  }, [isOpen]);

  return (
    <>
      {isOpen && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          tabIndex={-1}
          onClick={onClose}
        />
      )}
      <aside
        ref={sidebarRef}
        id="prompt-navigation"
        className={`sidebar ${isOpen ? "is-open" : ""} ${isCollapsed ? "is-collapsed" : ""}`}
        aria-label="Prompt navigation"
      >
        <div className="sidebar-brand">
          <a
            className="brand-link"
            href="#"
            onClick={(event) => {
              event.preventDefault();
              onNew();
            }}
            aria-label="Prompt Studio home"
          >
            Prompt Studio
          </a>
          <button
            className="icon-button sidebar-collapse"
            aria-label="Collapse navigation"
            title="Close sidebar"
            onClick={onCollapse}
            aria-controls="prompt-navigation"
            aria-expanded={!isCollapsed}
          >
            <PanelLeftClose size={20} />
          </button>
          <button
            className="icon-button sidebar-close"
            aria-label="Close navigation"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>

        <div className="sidebar-actions">
          <button className="new-prompt-button" onClick={onNew}>
            <SquarePen size={19} />
            <span>New prompt</span>
          </button>
          <div className="history-search">
            <Search size={18} />
            <input
              aria-label="Search prompt history"
              placeholder="Search prompts"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {search && (
              <button
                type="button"
                aria-label="Clear search"
                className="icon-button"
                onClick={() => setSearch("")}
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>

        <div className="sidebar-history">
          <div className="sidebar-section-label">Recent prompts</div>
          {filtered.length ? (
            <ul className="history-list">
              {filtered.map((session) => (
                <li
                  key={session.id}
                  className={`history-item ${activeId === session.id ? "is-active" : ""}`}
                >
                  <button
                    className="history-select"
                    onClick={() => onSelect(session.id)}
                    title={session.title}
                    aria-current={activeId === session.id ? "page" : undefined}
                  >
                    <span>{session.title}</span>
                  </button>
                  <button
                    className="history-delete icon-button"
                    onClick={() => onDelete(session.id)}
                    aria-label={`Delete ${session.title}`}
                    title="Delete prompt"
                  >
                    <Trash2 size={16} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="history-empty">
              <p>{search ? "No matching prompts." : "Your prompts, in one place."}</p>
              <span>
                {search ? "Try a different search." : "Your recent prompts will appear here."}
              </span>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
