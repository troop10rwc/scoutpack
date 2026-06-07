import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import type { Identity } from "../shared/types.ts";
import { resolveIdentity } from "./roster.ts";

// The verified Access subject before roster lookup: who they are plus whether
// the Access JWT puts them in LEADER_GROUP. The final role/position is resolved
// against the member_roles table (see roster.ts) — the group is only a fallback.
interface AuthSubject {
  email: string;
  name: string;
  inLeaderGroup: boolean;
}

// The whole troop10rwc.org domain sits behind Cloudflare Access (Zero Trust)
// with Slack as the identity provider. Access authenticates users at the edge
// before requests reach this Worker and injects a signed JWT
// (Cf-Access-Jwt-Assertion header / CF_Authorization cookie). We verify that
// JWT and read the user's identity from it — no app-level sign-in needed.

export interface AuthBindings {
  DB: D1Database;
  EVENTS: D1Database;
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

let jwksCache: { keys: JsonWebKey[]; expires: number } | null = null;

async function getSigningKeys(teamDomain: string): Promise<JsonWebKey[]> {
  if (jwksCache && jwksCache.expires > Date.now()) return jwksCache.keys;
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  const data = (await res.json()) as { keys?: JsonWebKey[] };
  jwksCache = { keys: data.keys ?? [], expires: Date.now() + 60 * 60 * 1000 };
  return jwksCache.keys;
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function decodeSegment<T = Record<string, unknown>>(s: string): T {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
}

interface AccessPayload {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  email?: string;
  custom?: Record<string, unknown> & { groups?: string[]; name?: string };
  groups?: string[];
}

function pickGroups(p: AccessPayload): string[] {
  // Access surfaces group memberships either as a top-level `groups` claim
  // or inside `custom`, depending on the IdP/SAML mapping.
  const g = p.groups ?? p.custom?.groups;
  return Array.isArray(g) ? g.filter((x): x is string => typeof x === "string") : [];
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

async function verifyAccessJwt(
  token: string,
  host: string,
  env: AuthBindings,
): Promise<AuthSubject | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;

  let header: { kid?: string; alg?: string };
  let payload: AccessPayload;
  try {
    header = decodeSegment(h);
    payload = decodeSegment(p);
  } catch {
    return null;
  }

  if (payload.iss !== `https://${env.CF_ACCESS_TEAM_DOMAIN}`) return null;
  const expectedAud = expectedAudForHost(host, env);
  if (!expectedAud) return null; // preview host with no preview AUD configured
  const aud = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
  if (!aud.includes(expectedAud)) return null;
  if (!payload.exp || payload.exp * 1000 < Date.now()) return null;

  const jwk = (await getSigningKeys(env.CF_ACCESS_TEAM_DOMAIN)).find(
    (k) => (k as JsonWebKey & { kid?: string }).kid === header.kid,
  );
  if (!jwk) return null;
  const key = await crypto.subtle.importKey(
    "jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"],
  );
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5", key, b64urlToBytes(sig), new TextEncoder().encode(`${h}.${p}`),
  );
  if (!ok) return null;

  const email = String(payload.email ?? "");
  if (!email) return null;
  const name = String(payload.custom?.name ?? email);
  const inLeaderGroup = pickGroups(payload).includes(env.LEADER_GROUP);
  return { email, name, inLeaderGroup };
}

export const requireAuth: MiddlewareHandler<{ Bindings: AuthBindings; Variables: { user: Identity } }> = async (c, next) => {
  let subject: AuthSubject | null;
  if (c.env.DEV_AUTH_BYPASS === "1") {
    subject = {
      email: c.env.DEV_AUTH_EMAIL ?? "dev@local",
      name: "Dev User",
      // In dev, DEV_AUTH_ROLE=leader stands in for LEADER_GROUP membership; the
      // real role/position is still resolved from member_roles below, so a dev
      // row can override it just like in production.
      inLeaderGroup: c.env.DEV_AUTH_ROLE === "leader",
    };
  } else {
    const token =
      c.req.header("Cf-Access-Jwt-Assertion") || getCookie(c, "CF_Authorization");
    const host = new URL(c.req.url).host;
    subject = token ? await verifyAccessJwt(token, host, c.env) : null;
  }
  if (!subject) return c.json({ error: "unauthorized" }, 401);
  const id = await resolveIdentity(
    c.env.DB,
    { email: subject.email, name: subject.name },
    subject.inLeaderGroup,
  );
  c.set("user", id);
  await next();
};

export function requireLeader(c: { get: (k: "user") => Identity }) {
  const u = c.get("user");
  if (u.role !== "leader") {
    const err = new Error("forbidden");
    (err as Error & { status?: number }).status = 403;
    throw err;
  }
}
