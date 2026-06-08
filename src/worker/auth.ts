import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { getAccessGroups, verifyAccessJwt } from "@troop10rwc/worker-kit";
import type { User } from "../shared/types.ts";
import { resolveUser } from "./roster.ts";

// The whole troop10rwc.org domain sits behind Cloudflare Access (Zero Trust)
// with Slack as the identity provider. Access authenticates users at the edge
// before requests reach this Worker and injects a signed JWT
// (Cf-Access-Jwt-Assertion header / CF_Authorization cookie). We verify that
// JWT via @troop10rwc/worker-kit (shared across all troop10rwc apps) and
// resolve the app-level identity here. No app-level sign-in needed.

export interface AuthBindings {
  DB: D1Database;
  EVENTS: D1Database;
  // Externally-managed roster DB (read-only). Drives role resolution.
  ROSTER: D1Database;
  CF_ACCESS_TEAM_DOMAIN: string;
  // AUD of the Access application protecting production on troop10rwc.org.
  CF_ACCESS_AUD: string;
  // AUD of the Access application protecting this Worker's *.workers.dev
  // preview URLs (the versions produced by `wrangler versions upload` on PR
  // builds). Same team JWKS as production, different AUD. On a preview host
  // this AUD — and only this AUD — is accepted.
  CF_ACCESS_AUD_PREVIEW?: string;
  // Access group name (custom claim) whose members are template editors.
  LEADER_GROUP: string;
  // DEV ONLY: when "1", skip Access and treat every request as a fixed dev user.
  DEV_AUTH_BYPASS?: string;
  DEV_AUTH_EMAIL?: string;
  DEV_AUTH_ROLE?: string; // "scout" | "leader"
}

// Production is served from troop10rwc.org; PR previews are served from this
// Worker's Cloudflare Preview URLs on *.workers.dev, fronted by a separate
// Access application. `wrangler versions upload` ships the same vars to both,
// so we pick which AUD to trust from the request host: a preview host accepts
// only the preview AUD, production accepts only the production AUD.
function expectedAudForHost(host: string, env: AuthBindings): string | null {
  if (host.endsWith(".workers.dev")) return env.CF_ACCESS_AUD_PREVIEW ?? null;
  return env.CF_ACCESS_AUD;
}

export const requireAuth: MiddlewareHandler<{
  Bindings: AuthBindings;
  Variables: { user: User };
}> = async (c, next) => {
  let base: { email: string; name: string };
  let inLeaderGroup: boolean;

  if (c.env.DEV_AUTH_BYPASS === "1") {
    base = { email: c.env.DEV_AUTH_EMAIL ?? "dev@local", name: "Dev User" };
    // DEV_AUTH_ROLE=leader stands in for LEADER_GROUP membership; the real
    // role/position is still resolved against roster-db + member_roles below,
    // so a dev override or roster match overrides this just like in production.
    inLeaderGroup = c.env.DEV_AUTH_ROLE === "leader";
  } else {
    const token =
      c.req.header("Cf-Access-Jwt-Assertion") || getCookie(c, "CF_Authorization");
    if (!token) return c.json({ error: "unauthorized" }, 401);
    const host = new URL(c.req.url).host;
    const audience = expectedAudForHost(host, c.env);
    if (!audience) return c.json({ error: "unauthorized" }, 401);
    try {
      base = await verifyAccessJwt(token, {
        teamDomain: c.env.CF_ACCESS_TEAM_DOMAIN,
        audience,
      });
      inLeaderGroup = getAccessGroups(token).includes(c.env.LEADER_GROUP);
    } catch (e) {
      // Surface the verify failure to Workers logs but return a generic 401.
      console.warn("Access JWT verify failed:", (e as Error).message);
      return c.json({ error: "unauthorized" }, 401);
    }
  }

  const user = await resolveUser(c.env.DB, c.env.ROSTER, base, inLeaderGroup);
  c.set("user", user);
  await next();
};

export function requireLeader(c: { get: (k: "user") => User }) {
  const u = c.get("user");
  if (u.role !== "leader") {
    const err = new Error("forbidden");
    (err as Error & { status?: number }).status = 403;
    throw err;
  }
}
