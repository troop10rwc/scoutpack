import { useEffect, useState } from "react";

// Hash-based router. Routes:
//   #/                  dashboard
//   #/closet            closet for active scout
//   #/event/:eventId    packing list for an event
//   #/templates         leader-only template editor
//   #/roster            leader-only roster / role editor

export type Route =
  | { kind: "dashboard" }
  | { kind: "closet" }
  | { kind: "event"; eventId: string }
  | { kind: "templates" }
  | { kind: "roster" };

function parse(hash: string): Route {
  const path = hash.replace(/^#/, "") || "/";
  if (path === "/" || path === "") return { kind: "dashboard" };
  if (path === "/closet") return { kind: "closet" };
  if (path === "/templates") return { kind: "templates" };
  if (path === "/roster") return { kind: "roster" };
  const m = /^\/event\/([^/]+)/.exec(path);
  if (m) return { kind: "event", eventId: decodeURIComponent(m[1]) };
  return { kind: "dashboard" };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parse(window.location.hash));
  useEffect(() => {
    const handler = () => setRoute(parse(window.location.hash));
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);
  return route;
}

export function navigate(path: string) {
  window.location.hash = path;
}
