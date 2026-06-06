import { useEffect, useState } from "react";
import { api } from "./api.ts";
import { navigate, useRoute } from "./router.ts";
import type { Me, Scout } from "../shared/types.ts";
import { Dashboard } from "./pages/Dashboard.tsx";
import { Closet } from "./pages/Closet.tsx";
import { EventDetail } from "./pages/EventDetail.tsx";
import { Templates } from "./pages/Templates.tsx";

const ACTIVE_SCOUT_KEY = "scoutpack.activeScoutId";

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeScoutId, setActiveScoutIdState] = useState<string | null>(
    () => localStorage.getItem(ACTIVE_SCOUT_KEY),
  );
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

  if (error) return <div className="error">Error: {error}</div>;
  if (!me) return <div className="loading">Loading…</div>;

  const activeScout = me.scouts.find((s) => s.id === activeScoutId) ?? me.scouts[0];

  return (
    <div className="app">
      <Header
        me={me}
        activeScout={activeScout}
        onSelectScout={setActiveScoutId}
        onAddScout={addScout}
      />
      <main>
        {route.kind === "dashboard" && activeScout && (
          <Dashboard scout={activeScout} me={me} />
        )}
        {route.kind === "closet" && activeScout && (
          <Closet scout={activeScout} />
        )}
        {route.kind === "event" && activeScout && (
          <EventDetail scout={activeScout} eventId={route.eventId} />
        )}
        {route.kind === "templates" && me.role === "leader" && <Templates />}
        {route.kind === "templates" && me.role !== "leader" && (
          <div className="error">Leaders only.</div>
        )}
      </main>
    </div>
  );
}

function Header({
  me,
  activeScout,
  onSelectScout,
  onAddScout,
}: {
  me: Me;
  activeScout?: Scout;
  onSelectScout: (id: string) => void;
  onAddScout: () => void;
}) {
  return (
    <header>
      <nav>
        <a href="#/" className="brand">scoutpack</a>
        <a href="#/">Upcoming</a>
        <a href="#/closet">Closet</a>
        {me.role === "leader" && <a href="#/templates">Templates</a>}
      </nav>
      <div className="profile-switcher">
        {me.scouts.length > 1 && (
          <select
            value={activeScout?.id ?? ""}
            onChange={(e) => onSelectScout(e.target.value)}
          >
            {me.scouts.map((s) => (
              <option key={s.id} value={s.id}>{s.display_name}</option>
            ))}
          </select>
        )}
        {me.scouts.length <= 1 && activeScout && (
          <span className="scout-name">{activeScout.display_name}</span>
        )}
        <button onClick={onAddScout} title="Add scout">+ scout</button>
      </div>
    </header>
  );
}
