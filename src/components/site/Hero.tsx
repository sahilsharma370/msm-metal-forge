import { forwardRef, useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import msmLogo from "@/assets/msm-logo.svg";
import scrapTexture from "@/assets/scrap-texture.webp";
import { WHATSAPP_URL } from "@/lib/site";
import { DotGrid } from "./DotGrid";

export const Hero = forwardRef<HTMLElement>(function Hero(_props, forwardedRef) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const spotlightRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const section = sectionRef.current;
    const spotlight = spotlightRef.current;
    if (!section || !spotlight) return;

    let raf = 0;
    let pending: { x: number; y: number } | null = null;

    const applyPosition = () => {
      raf = 0;
      if (!pending) return;
      spotlight.style.setProperty("--mouse-x", `${pending.x}px`);
      spotlight.style.setProperty("--mouse-y", `${pending.y}px`);
    };

    const handleMove = (e: MouseEvent) => {
      const rect = section.getBoundingClientRect();
      pending = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      spotlight.style.opacity = "1";
      if (!raf) raf = requestAnimationFrame(applyPosition);
    };

    const handleLeave = () => {
      spotlight.style.opacity = "0";
    };

    section.addEventListener("mousemove", handleMove);
    section.addEventListener("mouseleave", handleLeave);
    return () => {
      section.removeEventListener("mousemove", handleMove);
      section.removeEventListener("mouseleave", handleLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <section
      ref={(node) => {
        sectionRef.current = node;
        if (typeof forwardedRef === "function") forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      }}
      id="home"
      className="absolute inset-0 flex min-h-screen items-center overflow-hidden bg-[#080A1D] pt-36 pb-24 sm:pt-44"
    >
      <img
        ref={spotlightRef}
        src={scrapTexture}
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-300"
        style={{
          maskImage:
            "radial-gradient(circle 180px at var(--mouse-x, 50%) var(--mouse-y, 50%), black 0%, black 55%, transparent 100%)",
          WebkitMaskImage:
            "radial-gradient(circle 180px at var(--mouse-x, 50%) var(--mouse-y, 50%), black 0%, black 55%, transparent 100%)",
        }}
      />

      <DotGrid glow={0} interactive={false} />

      <div className="relative mx-auto flex max-w-4xl flex-col items-center px-6 text-center">
        <p className="label-eyebrow text-[oklch(0.72_0.13_60)]">United Arab Emirates</p>

        <div className="mt-8">
          <img
            src={msmLogo}
            alt="MSM Scrap — Mohammed Sihabuddin Metal Scrap Trading LLC"
            width={1174}
            height={417}
            className="w-64 sm:w-80"
          />
        </div>

        <h1 className="font-display mt-10 text-[2.6rem] leading-[1.08] font-bold tracking-[-0.02em] sm:text-[3.5rem]">
          <span className="text-copper-metal">14 Years</span> of Trusted Metal Trading in the UAE
        </h1>

        <p className="font-display mt-6 max-w-2xl text-base leading-[1.5] font-medium text-foreground/90 sm:text-lg">
          We buy, sell, import and export copper, aluminium, steel and lead scrap—with transparent
          weighing and UAE-wide pickup.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Link
            to="/"
            search={{ quote: true, source: "hero" }}
            mask={{ to: "/quote", search: { source: "hero" } }}
            className="font-display rounded-full bg-[image:var(--gradient-copper)] px-7 py-3 text-sm font-bold tracking-[0.1em] text-[#080A1D] uppercase shadow-[0_10px_30px_-10px_oklch(0.583_0.135_45.5/0.9)] transition-transform hover:scale-[1.03] hover:text-[#EDE8D0] hover:[text-shadow:0_1px_2px_rgba(8,10,29,0.65)]"
          >
            Get Quote →
          </Link>
          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noreferrer"
            className="font-display rounded-full border border-foreground/35 px-7 py-3.5 text-sm font-semibold tracking-[0.14em] uppercase transition-colors hover:border-[#25D366] hover:text-[#25D366]"
          >
            WhatsApp →
          </a>
        </div>
      </div>
    </section>
  );
});
