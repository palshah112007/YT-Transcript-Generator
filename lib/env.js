// Tiny .env reader used by the Vite dev middleware so server-only secrets
// (APIFY_TOKEN etc.) hot-reload on every request — no dev-server restart
// needed after editing .env. Vite handles VITE_* browser vars itself; this
// is only for server-only vars that must not reach the browser bundle.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function readEnvValue(name, dir = process.cwd()) {
  // Explicit environment wins (CI, shells, `vercel dev`, etc.)
  if (process.env[name]) return process.env[name];

  // Fresh read on every call => edits to .env are picked up instantly.
  for (const fileName of ['.env.local', '.env']) {
    const filePath = resolve(dir, fileName);
    if (!existsSync(filePath)) continue;
    const line = readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .find((l) => l.startsWith(`${name}=`));
    if (!line) continue;
    let value = line.slice(name.length + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) return value;
  }
  return undefined;
}
