import logoWhite from "@/assets/msm-logo-white.png";
import { WHATSAPP_URL } from "@/lib/site";
import { DotGrid } from "./DotGrid";
import { ScaleIcon } from "./ScaleIcon";

export function Hero() {
  return (
    <section id="home" className="relative overflow-hidden bg-navy-deep pt-36 pb-24 sm:pt-44">
      <DotGrid glow={1.35} />

      <div className="relative mx-auto flex max-w-4xl flex-col items-center px-6 text-center">
        <p className="label-eyebrow text-copper/90">United Arab Emirates</p>

        <div className="mt-8">
          <img
            src={logoWhite}
            alt="MSM Scrap — Mohammed Sihabuddin Metal Scrap Trading LLC"
            width={924}
            height={347}
            className="w-64 sm:w-80"
          />
        </div>

        <h1 className="font-display mt-10 text-[2.6rem] leading-[1.08] font-bold tracking-[-0.02em] sm:text-[3.5rem]">
          <span className="text-copper-metal">14 Years</span> of Trusted Metal Trading in the UAE
        </h1>

        <p className="mt-6 max-w-2xl text-base text-muted-foreground sm:text-lg">
          We buy, sell, export, and import all metal scrap — copper, aluminium, steel, and lead —
          with transparent weighing and UAE-wide pickup.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <a
            href="#contact"
            className="font-display rounded-full bg-copper px-7 py-3.5 text-sm font-semibold tracking-[0.14em] text-primary-foreground uppercase transition-transform hover:scale-[1.03]"
          >
            Get Quote →
          </a>
          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noreferrer"
            className="font-display rounded-full border border-foreground/35 px-7 py-3.5 text-sm font-semibold tracking-[0.14em] uppercase transition-colors hover:border-copper hover:text-copper"
          >
            WhatsApp →
          </a>
        </div>

        <div className="mt-20 flex flex-col items-center">
          <p className="label-eyebrow text-[0.65rem] text-muted-foreground">100%</p>
          <ScaleIcon className="animate-float-scale mt-5 h-16 w-20 text-copper/85" />
        </div>
      </div>
    </section>
  );
}