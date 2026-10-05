import { useRef } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Header } from "@/components/site/Header";
import { Hero } from "@/components/site/Hero";
import { TrustBar } from "@/components/site/TrustBar";
import { WhatWeDo } from "@/components/site/WhatWeDo";
import { Materials } from "@/components/site/Materials";
import { AboutTeaser } from "@/components/site/AboutTeaser";
import { ContactFooter } from "@/components/site/ContactFooter";
import { ScrollStack } from "@/components/site/ScrollStack";
import { SmoothScrollPreview } from "@/components/site/SmoothScrollPreview";
import { ScrollDebugOverlay } from "@/components/site/ScrollDebugOverlay";
import { QuoteExperience } from "@/components/site/quote/QuoteExperience";
import { indexSearchSchema, toInitialContext } from "@/components/site/quote/quote-search";

const title = "MSM Scrap | Metal Scrap Trading in Sharjah, UAE";
const description =
  "MSM Scrap buys, sells, exports and imports copper, aluminium, steel and lead scrap across the UAE with transparent weighing and UAE-wide pickup.";

export const Route = createFileRoute("/")({
  validateSearch: (search) => indexSearchSchema.parse(search),
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const heroWrapperRef = useRef<HTMLDivElement | null>(null);
  const heroRef = useRef<HTMLElement | null>(null);
  const trustBarRef = useRef<HTMLElement | null>(null);
  const search = Route.useSearch();
  const router = useRouter();

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main>
        <div ref={heroWrapperRef} className="hero-stage-height relative">
          <Hero ref={heroRef} />
        </div>
        {/* TrustBar's own always-`lg:min-h-screen` wrapper — see
            ScrollStack.tsx's and TrustBar.tsx's own comments for why
            sections after it need this to measure a stable position
            regardless of TrustBar's current fixed/absolute state. Mobile:
            `relative` only, no forced height — TrustBar's own mobile
            layout is ordinary, content-driven document flow, unaffected by
            this wrapper's presence. */}
        <div className="relative lg:min-h-screen">
          <TrustBar ref={trustBarRef} />
        </div>
        <WhatWeDo />
        <Materials />
        <AboutTeaser />
        <ContactFooter />
      </main>
      <ScrollStack heroWrapperRef={heroWrapperRef} heroRef={heroRef} trustBarRef={trustBarRef} />
      {/* ?smoothPreview=1 only — see SmoothScrollPreview.tsx's own doc
          comment. Default homepage (no query, or any other query) never
          mounts this, so the shipped site is untouched. */}
      {search.smoothPreview === 1 && <SmoothScrollPreview />}
      {import.meta.env.DEV && <ScrollDebugOverlay />}

      {search.quote && (
        <QuoteExperience
          mode="overlay"
          initialContext={toInitialContext(search, search.source ?? "direct")}
          onClose={() => router.history.back()}
        />
      )}
    </div>
  );
}
