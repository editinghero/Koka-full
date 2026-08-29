## 2024-05-18 - Fix Path Traversal in Media Stream Handler

**Vulnerability:** Path traversal (Directory Traversal) was possible via `/api/stream/video` and `/api/stream/subtitle` endpoints by passing `../` in the `file` query parameter.
**Learning:** `join` resolves `../` but does not prevent the resulting path from escaping the base directory. This meant an attacker could download arbitrary files from the host system (e.g., `../../../../etc/passwd`).
**Prevention:** Always validate that the final resolved path is contained within the intended base directory using `resolve` and string `startsWith` matching.
