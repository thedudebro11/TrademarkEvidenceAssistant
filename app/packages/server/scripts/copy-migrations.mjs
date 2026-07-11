import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// tsc only emits compiled .js — it does not copy non-TS assets. The raw
// .sql migration files must be copied into dist/ separately so the
// compiled server (run via plain `node dist/index.js`) can find them.
const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "src", "db", "migrations");
const dest = join(here, "..", "dist", "db", "migrations");

mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`Copied migrations: ${src} -> ${dest}`);
