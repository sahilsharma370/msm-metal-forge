import { createFileRoute } from "@tanstack/react-router";
import { Header } from "@/components/site/Header";
import { Hero } from "@/components/site/Hero";
import { TrustBar } from "@/components/site/TrustBar";
import { WhatWeDo } from "@/components/site/WhatWeDo";
import { Materials } from "@/components/site/Materials";
import { AboutTeaser } from "@/components/site/AboutTeaser";
import { ContactFooter } from "@/components/site/ContactFooter";

const title = "MSM Scrap | Metal Scrap Trading in Sharjah, UAE";
const description =
  "MSM Scrap buys, sells, exports and imports copper, aluminium, steel and lead scrap across the UAE with transparent weighing and UAE-wide pickup.";

export const Route = createFileRoute("/")({
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
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main>
        <Hero />
        <TrustBar />
        <WhatWeDo />
        <Materials />
        <AboutTeaser />
        <ContactFooter />
      </main>
    </div>
  );
}
