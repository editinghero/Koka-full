/**
 * Server-only runtime helpers.
 */

export function envVar(name: string): string | undefined {
  const fromNode = process.env[name];
  return fromNode || undefined;
}

export function signupsAllowed(): boolean {
  const raw = (envVar("ALLOW_SIGNUPS") ?? "true").toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "off";
}
