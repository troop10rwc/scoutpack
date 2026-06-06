// Branch-aware build wrapper for Workers Builds.
//
// Workers Builds runs ONE shared build command for every branch, then a
// per-branch-type deploy step (`wrangler deploy` for the production branch,
// `wrangler versions upload` for non-production branches). Because this project
// uses @cloudflare/vite-plugin, the target Wrangler environment is baked into
// the build output at build time via CLOUDFLARE_ENV — so the environment must
// be chosen here, not at deploy time.
//
// Rule: inside Workers Builds, on any branch other than the production branch,
// build the `preview` environment (-> Worker `scoutpack-preview`). The
// production branch and all local builds use the default/top-level config.
import { spawnSync } from "node:child_process";

const PRODUCTION_BRANCH = "main";

const inWorkersBuilds = process.env.WORKERS_CI === "1";
const branch = process.env.WORKERS_CI_BRANCH ?? "";

const env = { ...process.env };
// Only switch to preview inside CI, on a non-production branch, and only when
// the caller hasn't already pinned CLOUDFLARE_ENV (so a manual
// `CLOUDFLARE_ENV=preview npm run build` locally still works).
if (inWorkersBuilds && branch && branch !== PRODUCTION_BRANCH && !env.CLOUDFLARE_ENV) {
  env.CLOUDFLARE_ENV = "preview";
}

console.log(
  `[ci-build] WORKERS_CI=${process.env.WORKERS_CI ?? "(unset)"} ` +
    `branch=${branch || "(none)"} ` +
    `CLOUDFLARE_ENV=${env.CLOUDFLARE_ENV ?? "(unset -> production)"}`,
);

const res = spawnSync("vite build", { stdio: "inherit", env, shell: true });
process.exit(res.status ?? 1);
