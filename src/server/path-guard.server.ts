import { resolve, sep } from "node:path";

/**
 * Validates that a target file or folder path is strictly contained within an allowed base directory.
 * Prevents Directory Traversal (e.g. "../../../etc/passwd") attacks.
 */
export function isSafePath(base: string, target: string): boolean {
  if (!base || !target) return false;
  const resolvedBase = resolve(base);
  const resolvedTarget = resolve(target);
  return (
    resolvedTarget === resolvedBase ||
    resolvedTarget.startsWith(resolvedBase + sep)
  );
}
