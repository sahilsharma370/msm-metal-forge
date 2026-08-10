import { ArrowRight } from "lucide-react";
import { DotGrid } from "./DotGrid";

const COPPER = "oklch(0.583 0.135 45.5)";
const NAVY = "#080A1D";

function MonogramMark() {
  return (
    <svg viewBox="0 0 85 81" className="relative h-9 w-9" aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M21.02 7L0 40.5L21.02 74H64.89L85 39.6625L64.89 7H21.02ZM61 41C61 50.3888 52.94 58 43 58C33.06 58 25 50.3888 25 41C25 31.6112 33.06 24 43 24C52.94 24 61 31.6112 61 41Z"
        fill={COPPER}
      />
    </svg>
  );
}

function IndustryBadge() {
  return (
    <svg viewBox="0 0 100 100" className="h-24 w-24 shrink-0" aria-hidden="true">
      <circle
        cx="50"
        cy="50"
        r="46"
        fill="none"
        stroke={COPPER}
        strokeWidth="1"
        strokeDasharray="1 4"
        strokeLinecap="round"
        opacity="0.7"
      />
      <path id="badge-top-arc" d="M 15 50 A 35 35 0 0 1 85 50" fill="none" />
      <path id="badge-bottom-arc" d="M 85 50 A 35 35 0 0 1 15 50" fill="none" />
      <text fontSize="7.5" fontWeight="600" fill={COPPER} letterSpacing="1.5">
        <textPath href="#badge-top-arc" startOffset="50%" textAnchor="middle">
          YEARS IN
        </textPath>
      </text>
      <text fontSize="7.5" fontWeight="600" fill={COPPER} letterSpacing="1.5">
        <textPath href="#badge-bottom-arc" startOffset="50%" textAnchor="middle">
          THE INDUSTRY
        </textPath>
      </text>
      <text
        x="50"
        y="59"
        textAnchor="middle"
        fontSize="28"
        fontWeight="700"
        fill={COPPER}
        className="font-display"
      >
        14
      </text>
    </svg>
  );
}

export function AboutTeaser() {
  return (
    <section
      id="about"
      className="relative overflow-hidden py-[72px]"
      style={{ backgroundColor: NAVY }}
    >
      <DotGrid glow={0} className="z-0" />
      <div className="relative z-10 mx-auto max-w-[100rem] px-6">
        <div
          className="relative grid items-stretch gap-10 px-6 py-3 sm:px-10 sm:py-4 lg:min-h-[450px] lg:grid-cols-[300px_1fr]"
          style={{
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            border: "1px solid rgba(255, 255, 255, 0.18)",
            backgroundImage:
              "linear-gradient(135deg, rgba(255, 255, 255, 0.16) 0%, rgba(255, 255, 255, 0.03) 45%, rgba(255, 255, 255, 0) 65%)",
            boxShadow:
              "inset 0 1px 0 rgba(255, 255, 255, 0.25), inset 0 -1px 0 rgba(255, 255, 255, 0.05)",
          }}
        >
          <DotGrid glow={0} interactive={false} className="z-0" />
          <div
            aria-hidden="true"
            className="relative z-10 flex h-full w-full items-center justify-center overflow-hidden border"
            style={{
              backgroundColor: "#EDE8D0",
              borderColor: "oklch(0.583 0.135 45.5 / 0.3)",
            }}
          >
            <DotGrid glow={0} interactive={false} />
            <MonogramMark />
          </div>
          <div className="relative z-10 flex flex-col">
            <div className="flex items-center gap-4">
              <p className="label-eyebrow shrink-0 text-[oklch(0.583_0.135_45.5)]">
                The People Behind MSM
              </p>
              <span className="h-px flex-1 bg-[oklch(0.583_0.135_45.5)]/40" aria-hidden="true" />
              <IndustryBadge />
            </div>

            <blockquote
              className="mt-8 text-2xl leading-snug font-medium text-[#EDE8D0] italic sm:text-3xl"
              style={{ fontFamily: '"Baskerville", "Baskerville Old Face", Georgia, serif' }}
            >
              “Every load is weighed in front of the customer. That is how we built fourteen years
              of trust in this trade.”
            </blockquote>

            <div className="mt-8 flex items-start gap-4">
              <span
                className="mt-1 h-16 w-px shrink-0 bg-[oklch(0.583_0.135_45.5)]"
                aria-hidden="true"
              />
              <div>
                <p className="font-display text-lg font-bold text-[#EDE8D0]">Mohammed Sihabuddin</p>
                <p className="text-foreground/70">Owner, MSM Scrap</p>
              </div>
            </div>

            <a
              href="#contact"
              className="group mt-8 flex items-center gap-3 self-end transition-transform duration-[320ms] ease-[cubic-bezier(0.22,1,0.36,1)] hover:translate-x-[2px] motion-reduce:hover:translate-x-0"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[oklch(0.583_0.135_45.5)]/60 text-[oklch(0.583_0.135_45.5)] transition-[background-color,border-color] duration-[320ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:border-[oklch(0.583_0.135_45.5)] group-hover:bg-[oklch(0.583_0.135_45.5)]">
                <ArrowRight className="h-4 w-4 transition-[color,transform] duration-[320ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:translate-x-[3px] group-hover:text-[#080A1D] motion-reduce:group-hover:translate-x-0" />
              </span>
              <span className="font-display text-sm font-semibold tracking-[0.14em] text-[#EDE8D0] uppercase transition-colors duration-[320ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:text-[oklch(0.583_0.135_45.5)]">
                Read Our Full Story
              </span>
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
