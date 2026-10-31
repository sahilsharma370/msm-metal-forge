/**
 * CHECKPOINT C2F-C: relocated to src/lib/quote/submission-schema.ts so
 * browser code can import the pure shape/normalization parts (submission-
 * ShapeSchema, normalizeSubmission, MAX_FILES) too — this project's build
 * hard-denies any client-side import resolving under `**\/server/**`,
 * regardless of the file's own runtime safety (see
 * @lovable.dev/vite-tanstack-config's importProtection.client config). This
 * barrel exists purely so every existing server import of
 * "./submission-schema" keeps working unchanged; there is exactly one
 * implementation, at the path above, never two.
 */
export * from "@/lib/quote/submission-schema";
