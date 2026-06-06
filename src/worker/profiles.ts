import type { Scout } from "../shared/types.ts";

// Get or create the Account row for a Cloudflare Access identity.
export async function ensureAccount(db: D1Database, email: string): Promise<string> {
  const existing = await db
    .prepare(`SELECT id FROM accounts WHERE email = ?`)
    .bind(email)
    .first<{ id: string }>();
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  await db
    .prepare(`INSERT INTO accounts (id, email) VALUES (?, ?)`)
    .bind(id, email)
    .run();
  return id;
}

// First-login convenience: if an account has no scouts yet, create a default
// one. Parents can rename/add more later.
export async function ensureDefaultScout(
  db: D1Database,
  accountId: string,
  displayName: string,
): Promise<void> {
  const existing = await db
    .prepare(`SELECT 1 FROM scouts WHERE account_id = ? LIMIT 1`)
    .bind(accountId)
    .first<{ "1": number }>();
  if (existing) return;
  const id = crypto.randomUUID();
  await db
    .prepare(`INSERT INTO scouts (id, account_id, display_name) VALUES (?, ?, ?)`)
    .bind(id, accountId, displayName)
    .run();
}

export async function listScouts(db: D1Database, accountId: string): Promise<Scout[]> {
  const { results } = await db
    .prepare(`SELECT * FROM scouts WHERE account_id = ? ORDER BY created_at ASC`)
    .bind(accountId)
    .all<Scout>();
  return results ?? [];
}

export async function createScout(
  db: D1Database,
  accountId: string,
  displayName: string,
): Promise<Scout> {
  const id = crypto.randomUUID();
  await db
    .prepare(`INSERT INTO scouts (id, account_id, display_name) VALUES (?, ?, ?)`)
    .bind(id, accountId, displayName)
    .run();
  const row = await db
    .prepare(`SELECT * FROM scouts WHERE id = ?`)
    .bind(id)
    .first<Scout>();
  if (!row) throw new Error("failed to create scout");
  return row;
}

// Confirm a scout belongs to the calling account. Throws 403 otherwise.
export async function assertScoutOwned(
  db: D1Database,
  accountId: string,
  scoutId: string,
): Promise<void> {
  const row = await db
    .prepare(`SELECT 1 AS ok FROM scouts WHERE id = ? AND account_id = ?`)
    .bind(scoutId, accountId)
    .first<{ ok: number }>();
  if (!row) {
    const err = new Error("forbidden");
    (err as Error & { status?: number }).status = 403;
    throw err;
  }
}
