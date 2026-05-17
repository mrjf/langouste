import { mkdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

/**
 * Resolve the Langouste data directory for this platform.
 *
 * Order of precedence:
 *   1. LANGOUSTE_DATA_DIR env var (honoured verbatim).
 *   2. Platform default:
 *      - macOS:   ~/Library/Application Support/Langouste
 *      - Linux:   $XDG_DATA_HOME/langouste, or ~/.local/share/langouste
 *      - Windows: %APPDATA%/Langouste, or ~/AppData/Roaming/Langouste
 *      - other:   ~/.langouste
 *   3. Docker image overrides to /data via env (set in the image).
 *
 * The returned directory is guaranteed to exist.
 */
export function resolveDataDir(): string {
  const override = process.env.LANGOUSTE_DATA_DIR?.trim();
  const dir = override || platformDefault();
  mkdirSync(dir, { recursive: true });
  return dir;
}

function platformDefault(): string {
  const home = homedir();
  switch (platform()) {
    case "darwin":
      return join(home, "Library", "Application Support", "Langouste");
    case "win32": {
      const appData = process.env.APPDATA || join(home, "AppData", "Roaming");
      return join(appData, "Langouste");
    }
    case "linux": {
      const xdg = process.env.XDG_DATA_HOME?.trim();
      return xdg ? join(xdg, "langouste") : join(home, ".local", "share", "langouste");
    }
    default:
      return join(home, ".langouste");
  }
}

/**
 * Absolute path for a file or subdirectory inside the data dir. Creates parent
 * directories as needed when the caller intends to write to the path.
 */
export function dataPath(...parts: string[]): string {
  return join(resolveDataDir(), ...parts);
}

/** Ensure a subdirectory inside the data dir exists; return its absolute path. */
export function ensureDataSubdir(...parts: string[]): string {
  const path = dataPath(...parts);
  mkdirSync(path, { recursive: true });
  return path;
}
