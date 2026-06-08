import { createContext, useContext, useEffect, type ReactNode } from "react";

// The headstrip (title / subtitle / right-aligned actions) lives on AppShell,
// which App owns. Pages publish their chrome here so each page stays focused on
// content while AppShell renders one consistent topbar + sidebar + headstrip.
export interface Chrome {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Page-specific headstrip actions. The global scout switcher is added by App. */
  actions?: ReactNode;
}

const ChromeCtx = createContext<(c: Chrome) => void>(() => {});
export const ChromeProvider = ChromeCtx.Provider;

/**
 * Publish this page's headstrip chrome. `deps` controls when it re-publishes —
 * include anything the title/subtitle/actions close over (counts, the active
 * record, toggle state) so the headstrip stays in sync.
 */
export function usePageChrome(chrome: Chrome, deps: unknown[]): void {
  const set = useContext(ChromeCtx);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => set(chrome), deps);
}
