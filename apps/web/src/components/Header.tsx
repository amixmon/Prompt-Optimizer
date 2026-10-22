import { Moon, PanelLeft, SquarePen, Sun } from "lucide-react";

export interface HeaderProps {
  onToggleSidebar: () => void;
  sidebarExpanded: boolean;
  mobileSidebarExpanded: boolean;
  onNew: () => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
}

export function Header({
  onToggleSidebar,
  sidebarExpanded,
  mobileSidebarExpanded,
  onNew,
  theme,
  onToggleTheme,
}: HeaderProps) {
  return (
    <header className="workspace-header">
      <div className="header-left">
        <button
          id="sidebar-toggle"
          className="icon-button navigation-toggle desktop-menu"
          onClick={onToggleSidebar}
          aria-label={sidebarExpanded ? "Close navigation" : "Open navigation"}
          aria-controls="prompt-navigation"
          aria-expanded={sidebarExpanded}
          title={sidebarExpanded ? "Close sidebar" : "Open sidebar"}
        >
          <PanelLeft size={21} />
        </button>
        <button
          id="mobile-sidebar-toggle"
          className="icon-button navigation-toggle mobile-menu"
          onClick={onToggleSidebar}
          aria-label={mobileSidebarExpanded ? "Close navigation" : "Open navigation"}
          aria-controls="prompt-navigation"
          aria-expanded={mobileSidebarExpanded}
          title={mobileSidebarExpanded ? "Close sidebar" : "Open sidebar"}
        >
          <PanelLeft size={21} />
        </button>
        <span className="header-title">Prompt Studio</span>
      </div>
      <div className="header-right">
        <button
          className="icon-button theme-toggle"
          onClick={onToggleTheme}
          aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
          aria-pressed={theme === "dark"}
          title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
        >
          {theme === "light" ? <Moon size={20} /> : <Sun size={20} />}
        </button>
        <button
          className="icon-button header-new"
          onClick={onNew}
          aria-label="Start a new prompt"
          title="New prompt"
        >
          <SquarePen size={20} />
        </button>
      </div>
    </header>
  );
}
