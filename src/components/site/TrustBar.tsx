import { useEffect, useRef, useState } from "react";

const STATS = [
  { value: 14, suffix: "+", label: "Years Established" },
  { value: null, display: "UAE-Wide", label: "Pickup Coverage" },
  { value: 100, suffix: "%", label: "Transparent Weighing" },
  { value: 500, suffix: "+", label: "Happy Customers" },
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
    <section className="relative bg-navy-deep pb-24">
      <div ref={ref} className="mx-auto grid max-w-7xl gap-5 px-6 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map((stat) => (
          <div key={stat.label} className="glass-panel glass-ring rounded-2xl px-6 py-10 text-center">
            <div className="font-display text-3xl font-bold sm:text-4xl">
              {stat.value === null ? (
                stat.display
              ) : (
                <CountUp to={stat.value} suffix={stat.suffix} run={inView} />
              )}
            </div>
            <div className="label-eyebrow mt-3 text-[0.65rem] text-muted-foreground">
              {stat.label}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}