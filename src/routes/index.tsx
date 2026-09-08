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
        <div ref={heroWrapperRef} style={{ height: "100vh", position: "relative" }}>
          <Hero ref={heroRef} />
        </div>
        <TrustBar ref={trustBarRef} />
        <WhatWeDo />
        <Materials />
        <AboutTeaser />
        <ContactFooter />
      </main>
      <ScrollStack heroWrapperRef={heroWrapperRef} heroRef={heroRef} trustBarRef={trustBarRef} />

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
