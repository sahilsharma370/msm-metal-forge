import { useEffect, useRef, useState } from "react";
import { Scale, ShieldCheck, Truck, Users } from "lucide-react";
import skyline from "@/assets/dubai-skyline.jpg";
import { DotGrid } from "./DotGrid";

const STATS = [
  { value: 14, suffix: "+", label: "Years Established", Icon: ShieldCheck },
  { value: null, display: "UAE-Wide", label: "Pickup Coverage", Icon: Truck },
  { value: 100, suffix: "%", label: "Transparent Weighing", Icon: Scale },
  { value: 500, suffix: "+", label: "Happy Clients", Icon: Users },
] as const;

function useInView<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { ref, inView };
}

function CountUp({ to, suffix, run }: { to: number; suffix: string; run: boolean }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!run) return;
    let raf = 0;
    const start = performance.now();
    const duration = 1400;
    const tick = (now: number) => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(Math.round(to * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [run, to]);
  return (
    <>
      {n}
      {suffix}
    </>
  );
}

export function TrustBar() {
  const { ref, inView } = useInView<HTMLDivElement>();

  return (
    <section className="relative overflow-hidden bg-navy-deep">
      <img
        src={skyline}
        alt="Dubai skyline at night with the Burj Khalifa"
        loading="lazy"
        width={1920}
        height={832}
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-navy-deep/70 via-navy-deep/15 to-navy-deep/85" />

      {/* Dot texture over the sky only — masked out before the skyline itself */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[55%]"
        style={{
          maskImage: "linear-gradient(to bottom, black 55%, transparent 100%)",
          WebkitMaskImage: "linear-gradient(to bottom, black 55%, transparent 100%)",
        }}
      >
        <DotGrid glow={0.5} />
      </div>

      <div
        ref={ref}
        className="relative mx-auto grid max-w-7xl gap-5 px-6 pt-40 pb-44 sm:grid-cols-2 lg:grid-cols-4"
      >
        {STATS.map((stat) => (
          <div
            key={stat.label}
            className="glass-panel glass-ring flex flex-col items-center rounded-2xl px-6 py-9 text-center"
          >
            <stat.Icon className="h-6 w-6 text-copper" strokeWidth={1.5} aria-hidden="true" />
            <div className="font-display mt-5 text-3xl font-bold sm:text-4xl">
              {stat.value === null ? (
                stat.display
              ) : (
                <CountUp to={stat.value} suffix={stat.suffix} run={inView} />
              )}
            </div>
            <div className="label-eyebrow mt-3 text-[0.65rem] text-muted-foreground">
              {stat.label}
            </div>
            <div className="mt-5 h-px w-8 bg-copper" />
          </div>
        ))}
      </div>
    </section>
  );
}