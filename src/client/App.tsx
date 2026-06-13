import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AppShell,
  BackOfficeTopNav,
  Button,
  EmptyState,
  type NavGroup,
  type NavItem,
} from "@troop10rwc/ui";
import { api } from "./api.ts";
import { navigate, useRoute, type Route } from "./router.ts";
import { ChromeProvider, type Chrome } from "./chrome.tsx";
import type { Me, Scout } from "../shared/types.ts";
import { Dashboard } from "./pages/Dashboard.tsx";
import { Closet } from "./pages/Closet.tsx";
import { Wishlist } from "./pages/Wishlist.tsx";
import { EventDetail } from "./pages/EventDetail.tsx";
import { Templates } from "./pages/Templates.tsx";
import { RecommendedGear } from "./pages/RecommendedGear.tsx";
import { Roster } from "./pages/Roster.tsx";

const ACTIVE_SCOUT_KEY = "scoutpack.activeScoutId";
const SELECTED_EVENTS_KEY = "scoutpack.selectedEvents";

interface SelectedEvent {
  id: string;
  name: string;
}

// An event the active scout has a packing list for — i.e. one being actively
// worked on. Surfaced under "Upcoming" automatically (no need to have opened it).
interface WorkedEvent {
  id: string;
  name: string;
  start_at: string;
}

// Every event you open is remembered (deduped by id) so it stays a one-click
// shortcut under "Upcoming". Persisted as an array; a malformed/legacy value
// (the old single-object key) just yields an empty list.
function loadSelectedEvents(): SelectedEvent[] {
  try {
    const raw = localStorage.getItem(SELECTED_EVENTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as SelectedEvent[]) : [];
  } catch {
    return [];
  }
}

// scoutpack ships as the "gearlist" entry in the kit's BACK_OFFICE_APPS
// registry (mounted at /manage/gearlist). The cross-app product switcher
// (BackOfficeTopNav) highlights this id and pulls the rest of the app list
// from the kit, so the bar stays identical across the whole back office.
const APP_ID = "gearlist";

// The whole troop10rwc.org domain (and the *.workers.dev previews) sits behind
// Cloudflare Access; this host-relative path logs the user out at the edge on
// any of those hosts. See src/worker/auth.ts.
const ACCESS_LOGOUT_URL = "/cdn-cgi/access/logout";

// Grouped sidebar nav (NavGroup[]). "Operations" carries the scout-facing and
// leader-editing sections; "Roster" the role management. Each remembered event is
// injected as a child of "lists" at render time (see `nav` below). Leader-only
// items are gated with leaderOnly; the page itself is also gated in `Page`.
const NAV_GROUPS: NavGroup[] = [
  {
    label: "Operations",
    items: [
      { id: "lists", label: "Upcoming", icon: "◧" },
      { id: "closet", label: "Closet", icon: "⛺" },
      { id: "wishlist", label: "Wishlist", icon: "♡" },
      { id: "templates", label: "Templates", icon: "▤", leaderOnly: true },
      { id: "recommended", label: "Recommended Gear", icon: "✦", leaderOnly: true },
    ],
  },
  {
    label: "Roster",
    items: [{ id: "roster", label: "Roster", icon: "◉", leaderOnly: true }],
  },
];

// Sidebar id for the active highlight. A selected event is a child of "lists"
// (Upcoming) and gets its own id so it — not its parent — highlights on /event.
const ROUTE_TO_NAV: Record<Route["kind"], string> = {
  dashboard: "lists",
  event: "lists",
  closet: "closet",
  wishlist: "wishlist",
  templates: "templates",
  recommended: "recommended",
  roster: "roster",
};

const NAV_TO_PATH: Record<string, string> = {
  lists: "/",
  closet: "/closet",
  wishlist: "/wishlist",
  templates: "/templates",
  recommended: "/recommended",
  roster: "/roster",
};

const eventNavId = (id: string) => `event:${id}`;
const eventHref = (id: string) => `#/event/${encodeURIComponent(id)}`;

const DEFAULT_TITLE: Record<Route["kind"], string> = {
  dashboard: "Upcoming",
  event: "Packing List",
  closet: "Closet",
  wishlist: "Wishlist",
  templates: "Templates",
  recommended: "Recommended Gear",
  roster: "Roster & Roles",
};

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeScoutId, setActiveScoutIdState] = useState<string | null>(
    () => localStorage.getItem(ACTIVE_SCOUT_KEY),
  );
  const [chrome, setChrome] = useState<Chrome | null>(null);
  const [selectedEvents, setSelectedEvents] = useState<SelectedEvent[]>(loadSelectedEvents);
  const [workedEvents, setWorkedEvents] = useState<WorkedEvent[]>([]);
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

  // Reset the headstrip when the route changes, synchronously *during render* so
  // the freshly-mounted page's own chrome publish (a mount effect) always lands
  // last. An effect-based reset races the child's publish (effect order isn't
  // guaranteed parent-last, and StrictMode's double-invoke hides it in dev), so a
  // page whose chrome deps don't change after its data loads — e.g. Recommended
  // Gear with an empty catalog — could have its publish clobbered and show no
  // actions until a full reload. Resetting in render is order-independent.
  const routeKey = route.kind === "event" ? `event:${route.eventId}` : route.kind;
  const prevRouteKey = useRef(routeKey);
  if (prevRouteKey.current !== routeKey) {
    prevRouteKey.current = routeKey;
    setChrome(null);
  }

  // Remember every event you open so each stays a navigable shortcut under
  // "Upcoming" even after you move to another section. The event page publishes
  // its name as the chrome title; pin it once that real name lands (ignore the
  // generic placeholder shown while the packing list loads).
  const eventTitle =
    route.kind === "event" && typeof chrome?.title === "string" ? chrome.title : null;
  useEffect(() => {
    if (route.kind !== "event" || !eventTitle || eventTitle === DEFAULT_TITLE.event) return;
    setSelectedEvents((prev) => {
      const existing = prev.find((e) => e.id === route.eventId);
      if (existing && existing.name === eventTitle) return prev;
      const next = existing
        ? prev.map((e) => (e.id === route.eventId ? { ...e, name: eventTitle } : e))
        : [...prev, { id: route.eventId, name: eventTitle }];
      localStorage.setItem(SELECTED_EVENTS_KEY, JSON.stringify(next));
      return next;
    });
  }, [route.kind, route.kind === "event" ? route.eventId : "", eventTitle]);

  // Surface every event the active scout has a packing list for under "Upcoming"
  // automatically — these are the ones actively being worked on, distinct from the
  // localStorage shortcuts above (which only remember events you've opened). Refetch
  // on scout change and on each route change so a list generated elsewhere (e.g. the
  // dashboard's "Generate packing list") shows up as soon as you land on its page.
  useEffect(() => {
    if (!activeScoutId) return;
    let cancelled = false;
    api.upcomingEvents(activeScoutId)
      .then((evs) => {
        if (cancelled) return;
        setWorkedEvents(
          evs
            .filter((e) => e.packing)
            .map((e) => ({ id: e.id, name: e.name, start_at: e.start_at })),
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeScoutId, route.kind]);

  function setActiveScoutId(id: string) {
    localStorage.setItem(ACTIVE_SCOUT_KEY, id);
    setActiveScoutIdState(id);
  }

  // Unpin a remembered event from the "Upcoming" sub-menu.
  function unpinEvent(id: string) {
    setSelectedEvents((prev) => {
      const next = prev.filter((e) => e.id !== id);
      localStorage.setItem(SELECTED_EVENTS_KEY, JSON.stringify(next));
      return next;
    });
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
    route.kind === "dashboard" ||
    route.kind === "closet" ||
    route.kind === "wishlist" ||
    route.kind === "event";

  // Children of "Upcoming" come from two sources, deduped by id: events the scout
  // is actively working on (has a packing list — shown first, soonest-start first)
  // and events you've merely opened (localStorage shortcuts). The worked-on ones
  // are intrinsic, so they carry no unpin "×"; the opened-only ones do.
  const navChild = (ev: { id: string; name: string }, removable: boolean): NavItem => ({
    id: eventNavId(ev.id),
    href: eventHref(ev.id),
    label: (
      <span className="sp-navpin">
        <span className="sp-navpin__name">{ev.name}</span>
        {removable && (
          <span
            className="sp-navpin__x"
            role="button"
            tabIndex={0}
            aria-label={`Unpin ${ev.name}`}
            title="Unpin"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              unpinEvent(ev.id);
            }}
          >
            ×
          </span>
        )}
      </span>
    ),
  });
  const workedIds = new Set(workedEvents.map((e) => e.id));
  const upcomingChildren: NavItem[] = [
    ...[...workedEvents]
      .sort((a, b) => a.start_at.localeCompare(b.start_at))
      .map((ev) => navChild(ev, false)),
    ...selectedEvents.filter((e) => !workedIds.has(e.id)).map((ev) => navChild(ev, true)),
  ];
  const withPins = (item: NavItem): NavItem =>
    item.id === "lists" && upcomingChildren.length
      ? { ...item, children: upcomingChildren }
      : item;
  const nav: NavGroup[] = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.map(withPins),
  }));
  const active =
    route.kind === "event" ? eventNavId(route.eventId) : ROUTE_TO_NAV[route.kind];

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
      active={active}
      nav={nav}
      // Event children own their hash href; the static items route by id. Skip
      // event ids here so a pin click navigates once (via its href), not twice.
      onNavigate={(id) => {
        if (id.startsWith("event:")) return;
        navigate(NAV_TO_PATH[id] ?? "/");
      }}
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
    case "wishlist":
      return activeScout ? <Wishlist scout={activeScout} /> : <NoScout />;
    case "event":
      return activeScout ? (
        <EventDetail scout={activeScout} eventId={route.eventId} />
      ) : (
        <NoScout />
      );
    case "templates":
      return isLeader ? <Templates /> : <LeadersOnly />;
    case "recommended":
      return isLeader ? <RecommendedGear /> : <LeadersOnly />;
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
