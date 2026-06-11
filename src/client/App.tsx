import { useEffect, useState, type ReactNode } from "react";
import {
  AppShell,
  BackOfficeTopNav,
  Button,
  EmptyState,
  type NavItem,
} from "@troop10rwc/ui";
import { api } from "./api.ts";
import { navigate, useRoute, type Route } from "./router.ts";
import { ChromeProvider, type Chrome } from "./chrome.tsx";
import type { Me, Scout } from "../shared/types.ts";
import { Dashboard } from "./pages/Dashboard.tsx";
import { Closet } from "./pages/Closet.tsx";
import { EventDetail } from "./pages/EventDetail.tsx";
import { Templates } from "./pages/Templates.tsx";
import { Roster } from "./pages/Roster.tsx";

const ACTIVE_SCOUT_KEY = "scoutpack.activeScoutId";

// scoutpack ships as the "gearlist" entry in the kit's BACK_OFFICE_APPS
// registry (mounted at /manage/gearlist). The cross-app product switcher
// (BackOfficeTopNav) highlights this id and pulls the rest of the app list
// from the kit, so the bar stays identical across the whole back office.
const APP_ID = "gearlist";

// The whole troop10rwc.org domain (and the *.workers.dev previews) sits behind
// Cloudflare Access; this host-relative path logs the user out at the edge on
// any of those hosts. See src/worker/auth.ts.
const ACCESS_LOGOUT_URL = "/cdn-cgi/access/logout";

// AppShell groups nav by hard-coded ids: "lists" + "closet" under Operations,
// "roster" under Roster. Upcoming events and a single packing list both live
// under "lists"; the closet under "closet".
const NAV: NavItem[] = [
  { id: "lists", label: "Upcoming", icon: "◧" },
  { id: "closet", label: "Closet", icon: "⛺" },
  { id: "templates", label: "Templates", icon: "▤", leaderOnly: true },
  { id: "roster", label: "Roster", icon: "◉", leaderOnly: true },
];

const ROUTE_TO_NAV: Record<Route["kind"], string> = {
  dashboard: "lists",
  event: "lists",
  closet: "closet",
  templates: "templates",
  roster: "roster",
};

const NAV_TO_PATH: Record<string, string> = {
  lists: "/",
  closet: "/closet",
  templates: "/templates",
  roster: "/roster",
};

const DEFAULT_TITLE: Record<Route["kind"], string> = {
  dashboard: "Upcoming",
  event: "Packing List",
  closet: "Closet",
  templates: "Templates",
  roster: "Roster & Roles",
};

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeScoutId, setActiveScoutIdState] = useState<string | null>(
    () => localStorage.getItem(ACTIVE_SCOUT_KEY),
  );
  const [chrome, setChrome] = useState<Chrome | null>(null);
  const route = useRoute();

  useEffect(() => {
    api.me()
      .then((m) => {
        setMe(m);
        if (m.scouts.length && !m.scouts.find((s) => s.id === activeScoutId)) {
          setActiveScoutId(m.scouts[0].id);
        }
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  // Reset to the route default whenever the route changes; the mounted page
  // republishes its own chrome in an effect right after.
  useEffect(() => setChrome(null), [route.kind, route.kind === "event" ? route.eventId : ""]);

  function setActiveScoutId(id: string) {
    localStorage.setItem(ACTIVE_SCOUT_KEY, id);
    setActiveScoutIdState(id);
  }

  async function addScout() {
    const name = prompt("Scout name?");
    if (!name?.trim()) return;
    const scout = await api.createScout(name.trim());
    setMe((m) => (m ? { ...m, scouts: [...m.scouts, scout] } : m));
    setActiveScoutId(scout.id);
  }

  if (error) {
    return (
      <div className="t10-app" style={{ padding: 24 }}>
        <EmptyState>Error: {error}</EmptyState>
      </div>
    );
  }
  if (!me) {
    return (
      <div className="t10-app" style={{ padding: 24 }}>
        <EmptyState>Loading…</EmptyState>
      </div>
    );
  }

  const isLeader = me.role === "leader";
  const user = { name: me.name || me.email, role: isLeader ? "Leader" : "Scout" };
  const activeScout = me.scouts.find((s) => s.id === activeScoutId) ?? me.scouts[0];
  const scoutRoute =
    route.kind === "dashboard" || route.kind === "closet" || route.kind === "event";

  const switcher = scoutRoute && activeScout ? (
    <ScoutSwitcher
      scouts={me.scouts}
      active={activeScout}
      onSelect={setActiveScoutId}
      onAdd={addScout}
    />
  ) : null;

  return (
    <AppShell
      active={ROUTE_TO_NAV[route.kind]}
      nav={NAV}
      onNavigate={(id) => navigate(NAV_TO_PATH[id] ?? "/")}
      isLeader={isLeader}
      appSwitcher={
        <BackOfficeTopNav active={APP_ID} user={user} logoutUrl={ACCESS_LOGOUT_URL} />
      }
      title={chrome?.title ?? DEFAULT_TITLE[route.kind]}
      subtitle={chrome?.subtitle}
      actions={(switcher || chrome?.actions) && (
        <>
          {switcher}
          {chrome?.actions}
        </>
      )}
    >
      <ChromeProvider value={setChrome}>
        <Page me={me} route={route} activeScout={activeScout} isLeader={isLeader} />
      </ChromeProvider>
    </AppShell>
  );
}

function Page({
  me,
  route,
  activeScout,
  isLeader,
}: {
  me: Me;
  route: Route;
  activeScout?: Scout;
  isLeader: boolean;
}): ReactNode {
  switch (route.kind) {
    case "dashboard":
      return activeScout ? <Dashboard scout={activeScout} me={me} /> : <NoScout />;
    case "closet":
      return activeScout ? <Closet scout={activeScout} /> : <NoScout />;
    case "event":
      return activeScout ? (
        <EventDetail scout={activeScout} eventId={route.eventId} />
      ) : (
        <NoScout />
      );
    case "templates":
      return isLeader ? <Templates /> : <LeadersOnly />;
    case "roster":
      return isLeader ? <Roster meEmail={me.email} /> : <LeadersOnly />;
  }
}

function NoScout() {
  return <EmptyState>Add a scout to get started.</EmptyState>;
}

function LeadersOnly() {
  return <EmptyState>Leaders only.</EmptyState>;
}

function ScoutSwitcher({
  scouts,
  active,
  onSelect,
  onAdd,
}: {
  scouts: Scout[];
  active: Scout;
  onSelect: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {scouts.length > 1 ? (
        <div className="t10-field__box" style={{ padding: "5px 9px" }}>
          <select value={active.id} onChange={(e) => onSelect(e.target.value)}>
            {scouts.map((s) => (
              <option key={s.id} value={s.id}>{s.display_name}</option>
            ))}
          </select>
        </div>
      ) : (
        <span className="t10-sub">{active.display_name}</span>
      )}
      <Button size="sm" onClick={onAdd}>+ Scout</Button>
    </div>
  );
}
