import { createFileRoute } from "@tanstack/react-router";
import { ShieldCheck, Truck, Users } from "lucide-react";
import { Header } from "@/components/site/Header";
import { ContactFooter } from "@/components/site/ContactFooter";
import { ArrowLinkCTA, MonogramMark } from "@/components/site/AboutTeaser";
import craneBackground from "@/assets/trust-industrial-crane.webp";

const title = "About MSM Scrap | Metal Scrap Trading in the UAE";
const description =
  "Learn about Mohammed Sihabuddin Metal Scrap Trading LLC and its approach to transparent, dependable metal scrap trading across the UAE.";

export const Route = createFileRoute("/about")({
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
  component: AboutPage,
});

const PRINCIPLES = [
  {
    Icon: ShieldCheck,
    label: "Transparent Dealing",
    copy: "Clear communication around the material, grade, weighing and next steps.",
  },
  {
    Icon: Truck,
    label: "Reliable Coordination",
    copy: "Practical support from enquiry and evaluation through pickup or supply.",
  },
  {
    Icon: Users,
    label: "Long-Term Relationships",
    copy: "An approach designed to earn repeat trust—not simply complete one transaction.",
  },
];

function AboutPage() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main>
        {/* 1. About hero */}
        <section className="relative overflow-hidden bg-[#080A1D] pt-32 pb-20 sm:pt-36">
          <img
            src={craneBackground}
            alt=""
            aria-hidden="true"
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover object-center opacity-40"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[#080A1D]/70 via-[#080A1D]/55 to-[#080A1D]" />

          <div className="relative mx-auto max-w-5xl px-6">
            <ArrowLinkCTA to="/" label="Back to Home" direction="left" />

            <p className="label-eyebrow mt-8 text-[oklch(0.62_0.13_50)]">About MSM</p>
            <h1 className="font-display mt-4 max-w-3xl text-3xl font-bold tracking-[0.02em] text-[#EDE8D0] uppercase sm:text-5xl">
              Built on clear dealing. Trusted across the UAE.
            </h1>
            <p className="font-display mt-6 max-w-2xl text-base font-medium text-[#EDE8D0]/78 sm:text-lg">
              Mohammed Sihabuddin Metal Scrap Trading LLC connects sellers and buyers of copper,
              aluminium, steel, iron and lead scrap across the UAE. Our work is built around
              straightforward communication, transparent weighing and dependable coordination—from
              enquiry to collection.
            </p>
          </div>
        </section>

        {/* 2. Our story — the one warm/ivory section on this page; every
            other section stays deep navy. Muted (not bright/yellow) ivory,
            with a static, non-animated dot texture at ~4.5% opacity — no
            canvas, no listeners, purely decorative. */}
        <section className="relative py-14 sm:py-16" style={{ backgroundColor: "#E7E1CF" }}>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-[0.045]"
            style={{
              backgroundImage: "radial-gradient(#080A1D 1px, transparent 1px)",
              backgroundSize: "22px 22px",
            }}
          />
          <div className="relative mx-auto max-w-3xl px-6">
            <p className="label-eyebrow text-[oklch(0.583_0.135_45.5)]">Our Story</p>
            <h2 className="font-display mt-4 text-2xl font-bold tracking-[0.02em] text-[#080A1D] uppercase sm:text-3xl">
              A practical business, built relationship by relationship.
            </h2>
            <p className="font-display mt-6 text-base leading-[1.7] font-medium text-[#080A1D]/85 sm:text-lg">
              MSM began with a simple operating principle: make every transaction clear, fair and
              easy to follow. That principle continues to guide how we assess material, coordinate
              collection and keep customers informed.
            </p>
            <p className="font-display mt-5 text-base leading-[1.7] font-medium text-[#080A1D]/85 sm:text-lg">
              Led by Mohammed Sihabuddin, the business supports individuals, contractors, workshops
              and commercial partners with buying, selling, import and export coordination. Whether
              the requirement is a single pickup or an ongoing supply relationship, the focus
              remains the same: understand the material, agree the process and follow through.
            </p>
          </div>
        </section>

        {/* 3. How we work */}
        <section className="bg-[#080A1D] py-20 sm:py-24">
          <div className="mx-auto max-w-6xl px-6">
            <p className="label-eyebrow text-[oklch(0.62_0.13_50)]">How We Work</p>
            <h2 className="font-display mt-4 text-2xl font-bold tracking-[0.02em] text-[#EDE8D0] uppercase sm:text-3xl">
              Clear at every step.
            </h2>

            <div className="mt-10 grid gap-6 sm:grid-cols-3">
              {PRINCIPLES.map(({ Icon, label, copy }) => (
                <div
                  key={label}
                  className="rounded-2xl px-6 py-7 text-left"
                  style={{
                    backgroundColor: "oklch(0.22 0.05 265 / 0.55)",
                    backdropFilter: "blur(16px) saturate(140%)",
                    WebkitBackdropFilter: "blur(16px) saturate(140%)",
                    border: "1px solid oklch(0.583 0.135 45.5 / 0.18)",
                    boxShadow:
                      "inset 0 1px 0 oklch(1 0 0 / 0.08), 0 12px 28px -16px oklch(0.05 0.03 265 / 0.6)",
                  }}
                >
                  <Icon
                    className="h-6 w-6 text-[oklch(0.62_0.13_50)]"
                    strokeWidth={1.5}
                    aria-hidden="true"
                  />
                  <p className="font-display mt-4 text-sm font-bold tracking-[0.04em] text-[#EDE8D0] uppercase">
                    {label}
                  </p>
                  <p className="font-display mt-2 text-sm leading-relaxed text-[#EDE8D0]/70">
                    {copy}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 4. Owner's note — same deep-navy family as How We Work (not the
            lighter --background token), separated from it purely by a thin
            low-opacity copper divider since the two sections now read as
            one continuous tone rather than a distinct corporate-blue band. */}
        <section
          className="py-14 sm:pt-12 sm:pb-16"
          style={{
            backgroundColor: "#080A1D",
            borderTop: "1px solid oklch(0.583 0.135 45.5 / 0.14)",
          }}
        >
          <div className="mx-auto grid max-w-5xl items-center gap-10 px-6 sm:grid-cols-[220px_1fr]">
            {/* Owner portrait placeholder — plain solid navy, no internal
                dot layer. Restore a real photograph here once one is
                approved. */}
            <div
              aria-hidden="true"
              className="relative mx-auto flex aspect-[4/5] w-full max-w-[220px] items-center justify-center overflow-hidden border"
              style={{
                backgroundColor: "oklch(0.195 0.055 265.5)",
                borderColor: "oklch(0.583 0.135 45.5 / 0.45)",
              }}
            >
              <div className="relative z-10 flex flex-col items-center gap-2">
                <MonogramMark className="h-[42px] w-[42px]" />
                <p className="label-eyebrow text-[0.6rem] text-[#EDE8D0]/40">Owner Portrait</p>
              </div>
            </div>

            <div>
              <p className="label-eyebrow text-[oklch(0.62_0.13_50)]">Owner’s Note</p>
              <blockquote
                className="mt-5 text-xl leading-snug font-semibold text-[#EDE8D0] italic sm:text-2xl"
                style={{ fontFamily: '"Baskerville", "Baskerville Old Face", Georgia, serif' }}
              >
                “In this trade, trust is earned at the scale—through fair weights, clear dealing
                and every commitment kept.”
              </blockquote>
              <div className="mt-6 flex items-start gap-4">
                <span
                  className="mt-1 h-12 w-px shrink-0 bg-[oklch(0.583_0.135_45.5)]"
                  aria-hidden="true"
                />
                <div>
                  <p className="font-display text-base font-bold text-[#EDE8D0]">
                    Mohammed Sihabuddin
                  </p>
                  <p className="text-sm text-[#EDE8D0]/70">Owner, MSM Scrap</p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
      <ContactFooter />
    </div>
  );
}
