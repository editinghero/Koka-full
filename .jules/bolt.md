## 2024-05-19 - Filter Loop Lookups

**Learning:** Checking a large property array (like the `library`) element by element against another large array (like `scanState`) inside a `useMemo` operation that triggers on many events causes nested array lookups of the form O(N * M).
**Action:** Pre-compute the `Set` representations using `useMemo` on the secondary arrays so that loop lookups become O(1), making overall filtration O(N + M). This resolves high latency overheads during library renders.
