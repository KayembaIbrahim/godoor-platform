/**
 * Minimal ESM resolver so the verification scripts can import application
 * modules under their `@/…` path alias, which Node does not understand on its
 * own. Without this the scripts could only test code that had no imports, which
 * is exactly the code that has the least interesting behaviour.
 *
 * Usage: node --import ./scripts/register-alias.mjs scripts/<file>.mts
 */

import { existsSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = resolvePath(process.cwd(), "src");
const EXTENSIONS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    const base = resolvePath(SRC, specifier.slice(2));
    for (const ext of EXTENSIONS) {
      const candidate = base + ext;
      if (existsSync(candidate)) {
        return next(pathToFileURL(candidate).href, context);
      }
    }
  }

  /* Application modules import their siblings extensionlessly (`./promo`), which
     TypeScript resolves via `moduleResolution: bundler` but Node does not. Only
     the verification scripts ever hit this branch — the app is bundled by
     Next — so filling the same extension list here keeps tests able to import
     real modules instead of copies of them. */
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const parent = context.parentURL ? fileURLToPath(context.parentURL) : null;
    if (parent) {
      const base = resolvePath(dirname(parent), specifier);
      for (const ext of EXTENSIONS) {
        const candidate = base + ext;
        if (existsSync(candidate) && !candidate.endsWith("/")) {
          return next(pathToFileURL(candidate).href, context);
        }
      }
    }
  }
  return next(specifier, context);
}
