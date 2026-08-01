import logoAsset from "@/assets/msm-logo-v2.png.asset.json";
import { WHATSAPP_URL } from "@/lib/site";
import { DotGrid } from "./DotGrid";
import { ScaleIcon } from "./ScaleIcon";

export function Hero() {
  return (
    <section id="home" className="relative overflow-hidden bg-navy-deep pt-36 pb-24 sm:pt-44">
      <DotGrid glow={1.35} />

      <div className="relative mx-auto flex max-w-4xl flex-col items-center px-6 text-center">
        <p
          className="label-eyebrow animate-rise-in text-copper/90"
          style={{ animationDelay: "1.75s" }}
        >
          United Arab Emirates
        </p>

        <div
          className="mt-8 rounded-2xl bg-foreground/95 px-6 py-4 shadow-[0_24px_60px_-24px_oklch(0.12_0.05_265/0.8)]"
          style={{
            animation: "logo-cut-reveal 1.1s cubic-bezier(0.76, 0, 0.24, 1) 0.6s both",
          }}
        >
          <img
            src={logoAsset.url}
            alt="MSM Scrap — Mohammed Sihabuddin Metal Scrap Trading LLC"
            width={1490}
            height={508}
            className="w-56 sm:w-72"
          />
        </div>

        <h1
          className="font-display animate-rise-in mt-10 text-[2.6rem] leading-[1.08] font-bold tracking-[-0.02em] sm:text-[3.5rem]"
          style={{ animationDelay: "1.95s" }}
        >
          <span className="text-copper-metal">14 Years</span> of Trusted Metal Trading in the UAE
        </h1>

        <p
          className="animate-rise-in mt-6 max-w-2xl text-base text-muted-foreground sm:text-lg"
          style={{ animationDelay: "2.15s" }}
        >
          We buy, sell, export, and import all metal scrap — copper, aluminium, steel, and lead —
          with transparent weighing and UAE-wide pickup.
        </p>

        <div
          className="animate-rise-in mt-10 flex flex-wrap items-center justify-center gap-4"
          style={{ animationDelay: "2.35s" }}
        >
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

        <div
          className="animate-settle-in mt-20 flex flex-col items-center"
          style={{ animationDelay: "2.6s" }}
        >
          <p className="label-eyebrow text-[0.65rem] text-muted-foreground">100%</p>
          <ScaleIcon className="animate-float-scale mt-5 h-16 w-20 text-copper/85" />
        </div>
      </div>
    </section>
  );
}