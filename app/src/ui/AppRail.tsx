import { useState, type MouseEvent, type ReactNode } from "react";

import type { ChangeCase } from "../domain/case";
import { Button } from "./components/ui/Button";
import { Input } from "./components/ui/Input";
import { Icons } from "./icons";
import type { AppRoute, WorkspacePage } from "./routes";
import { caseMatchesQuery, WORKSPACE_PAGE_SIZE } from "./workspace-selectors";

export interface RailSessionAction {
  readonly busy: boolean;
  readonly error?: string;
  readonly onSignOut: () => void;
}

interface WorkspaceLinkProps {
  readonly destination: string;
  readonly onNavigate: (destination: string) => void;
  readonly children: ReactNode;
  readonly className?: string;
  readonly current?: boolean;
}

export function WorkspaceLink({ destination, onNavigate, children, className, current = false }: WorkspaceLinkProps) {
  return (
    <a
      href={destination}
      {...(className === undefined ? {} : { className })}
      {...(current ? { "aria-current": "page" as const } : {})}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onNavigate(destination);
      }}
    >{children}</a>
  );
}

const destinations: readonly Readonly<{ page: WorkspacePage; label: string; href: string; icon: typeof Icons.home }>[] = [
  { page: "home", label: "Home", href: "/workspace", icon: Icons.home },
  { page: "cases", label: "Cases", href: "/workspace/cases", icon: Icons.cases },
  { page: "work", label: "Work", href: "/workspace/work", icon: Icons.work },
  { page: "approvals", label: "Approvals", href: "/workspace/approvals", icon: Icons.approvals },
];

function currentPage(route: Exclude<AppRoute, { kind: "landing" | "public-not-found" | "case-redirect" }>): WorkspacePage | undefined {
  if (route.kind === "workspace") return route.page;
  if (route.kind === "case") return "cases";
  return undefined;
}

function Navigation({ route, onNavigate, label }: Readonly<{
  route: Exclude<AppRoute, { kind: "landing" | "public-not-found" | "case-redirect" }>;
  onNavigate: (destination: string) => void;
  label: string;
}>) {
  const active = currentPage(route);
  return (
    <nav aria-label={label}>
      {destinations.map((destination) => {
        const Icon = destination.icon;
        return <WorkspaceLink
          className="app-nav-link"
          current={active === destination.page}
          destination={destination.href}
          key={destination.page}
          onNavigate={onNavigate}
        >
          <Icon aria-hidden="true" size={19} strokeWidth={1.8} />
          <span className="nav-label">{destination.label}</span>
        </WorkspaceLink>;
      })}
    </nav>
  );
}

function CanonicalStatus({ label = "Canonical DataHub context" }: Readonly<{ label?: string }>) {
  return (
    <div className="rail-foot" role="status" aria-label={label} aria-live="polite">
      <Icons.database className="canonical-icon" aria-hidden="true" size={18} strokeWidth={1.8} />
      <span>DataHub canonical</span>
    </div>
  );
}

function SessionAction({ value, disabled, label, mobile = false }: Readonly<{
  value: RailSessionAction | undefined;
  disabled: boolean;
  label?: string;
  mobile?: boolean;
}>) {
  if (value === undefined) return null;
  return (
    <div className="rail-session">
      {value.error !== undefined && (
        <p role={mobile ? "status" : "alert"} {...(mobile ? { "aria-live": "assertive" as const } : {})}>
          <strong>Sign-out failed.</strong> {value.error}
        </p>
      )}
      <Button
        className="rail-sign-out"
        variant="ghost"
        disabled={disabled || value.busy}
        {...(label === undefined ? {} : { "aria-label": label })}
        onClick={value.onSignOut}
      >
        <Icons.logout aria-hidden="true" size={17} />
        {value.busy ? "Signing out…" : "Sign out"}
      </Button>
    </div>
  );
}

export function AppRail({ route, onNavigate, sessionAction, disabled }: Readonly<{
  route: Exclude<AppRoute, { kind: "landing" | "public-not-found" | "case-redirect" }>;
  onNavigate: (destination: string) => void;
  sessionAction?: RailSessionAction;
  disabled: boolean;
}>) {
  return (
    <aside className="app-rail" aria-label="Workspace application rail">
      <div className="brand-lockup"><span className="cut-mark">CM/</span><span>ChangeMarshal</span></div>
      <p className="rail-label">Operations</p>
      <Navigation route={route} onNavigate={onNavigate} label="Workspace navigation" />
      <CanonicalStatus />
      <SessionAction value={sessionAction} disabled={disabled} />
    </aside>
  );
}

export function MobileWorkspaceMenu({ route, onNavigate, sessionAction, disabled }: Readonly<{
  route: Exclude<AppRoute, { kind: "landing" | "public-not-found" | "case-redirect" }>;
  onNavigate: (destination: string) => void;
  sessionAction?: RailSessionAction;
  disabled: boolean;
}>) {
  return (
    <details className="mobile-workspace-menu">
      <summary><Icons.menu aria-hidden="true" size={18} /> Menu</summary>
      <Navigation route={route} onNavigate={onNavigate} label="Mobile application navigation" />
      <CanonicalStatus label="DataHub source status" />
      <SessionAction value={sessionAction} disabled={disabled} label="End operator session" mobile />
    </details>
  );
}

export function CasePicker({ cases, disabled, onOpenCase }: Readonly<{
  cases: readonly ChangeCase[];
  disabled: boolean;
  onOpenCase: (caseKey: string) => Promise<void>;
}>) {
  const [query, setQuery] = useState("");
  const allMatches = query.trim().length === 0 ? [] : cases.filter((value) => caseMatchesQuery(value, query));
  const matches = allMatches.slice(0, WORKSPACE_PAGE_SIZE);
  const resultsVisible = query.trim().length > 0;
  return (
    <div className="case-picker">
      <label htmlFor="workspace-case-picker">Find a governed case</label>
      <div className="case-picker-input">
        <Icons.search aria-hidden="true" size={17} />
        <Input
        id="workspace-case-picker"
        type="search"
        role="searchbox"
        value={query}
        disabled={disabled}
        autoComplete="off"
        aria-controls={resultsVisible ? "workspace-case-picker-results" : undefined}
        aria-expanded={resultsVisible}
        placeholder="Case key, repository, or model"
        onChange={(event) => setQuery(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setQuery("");
        }}
        />
      </div>
      {resultsVisible && (
        <div id="workspace-case-picker-results" className="case-picker-results" role="list" aria-label="Matching governed cases">
          {matches.map((value) => (
            <div key={value.caseKey} role="listitem">
              <a
                href={`/workspace/cases/${value.caseKey}/overview`}
                onClick={(event) => {
                  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  if (!disabled) void onOpenCase(value.caseKey);
                }}
              >
                <strong>{value.change.modelName}</strong>
                <span>{value.repository}</span>
                <code>{value.caseKey}</code>
              </a>
            </div>
          ))}
          {matches.length === 0 && <p role="status">No real governed cases match this search.</p>}
          {allMatches.length > WORKSPACE_PAGE_SIZE && (
            <p role="status">Showing the first {WORKSPACE_PAGE_SIZE} of {allMatches.length} governed cases. Refine the search to narrow the collection.</p>
          )}
        </div>
      )}
    </div>
  );
}
