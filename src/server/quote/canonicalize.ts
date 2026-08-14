/**
 * CHECKPOINT C2F-C: relocated to src/lib/quote/canonicalize.ts so browser
 * code can import it too — this project's build hard-denies any client-side
 * import resolving under `**\/server/**`, regardless of the file's own
 * runtime safety (see @lovable.dev/vite-tanstack-config's
 * importProtection.client config). This barrel exists purely so every
 * existing server import of "./canonicalize" / "../quote/canonicalize"
 * keeps working unchanged; there is exactly one implementation, at the path
 * above, never two.
 */
export * from "@/lib/quote/canonicalize";
