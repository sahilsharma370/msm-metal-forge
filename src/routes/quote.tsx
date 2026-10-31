import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { QuoteExperience } from "@/components/site/quote/QuoteExperience";
import { quoteRouteSearchSchema, toInitialContext } from "@/components/site/quote/quote-search";

const title = "Get a Quote | MSM Scrap";
const description = "Request a quote to sell or buy metal scrap with MSM Scrap, UAE.";

export const Route = createFileRoute("/quote")({
  validateSearch: (search) => quoteRouteSearchSchema.parse(search),
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
    ],
  }),
  component: QuoteRouteComponent,
});

/**
 * Standalone fallback: a direct hit, reload or shared link for `/quote`
 * always lands here (masking only rewrites the address bar for client-side
 * navigations started from "/" — the server has no concept of a mask).
 */
function QuoteRouteComponent() {
  const search = Route.useSearch();
  const navigate = useNavigate();

  return (
    <QuoteExperience
      mode="standalone"
      initialContext={toInitialContext(search, "direct")}
      onClose={() => navigate({ to: "/", search: {} })}
    />
  );
}
