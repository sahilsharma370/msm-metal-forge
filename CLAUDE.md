# Working Rules — Token Discipline

- Do NOT run browser screenshots, visual inspection, dev-server checks, or automated test/verification scripts unless explicitly instructed in the prompt.
- Do NOT inspect, crop, or pixel-analyze uploaded/reference images. Use only the exact values (hex codes, sizes, text) given directly in the prompt.
- Keep every task strictly scoped to what is asked. Do not make unrelated "while I'm here" fixes, refactors, or improvements.
- Prefer direct, targeted file edits over exploratory reads across the codebase. Only read files that are directly named or clearly necessary for the requested change.
- Do not run long-running shell loops, watchers, or repeated build/dev commands as part of completing a task.
- If a task genuinely requires visual inspection or testing to be done correctly, stop and ask before doing it, instead of doing it automatically.
