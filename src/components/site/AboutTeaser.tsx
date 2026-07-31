import owner from "@/assets/owner.jpg";
import { DotGrid } from "./DotGrid";

export function AboutTeaser() {
  return (
    <section id="about" className="relative overflow-hidden bg-navy-deep py-28">
      <DotGrid glow={1.1} />
      <div className="relative mx-auto max-w-6xl px-6">
        <div className="glass-panel glass-ring grid items-center gap-10 rounded-3xl p-8 sm:p-12 lg:grid-cols-[300px_1fr]">
          <img
            src={owner}
            alt="Mohammed Sihabuddin, owner of MSM Scrap"
            loading="lazy"
            width={1024}
            height={1024}
            className="aspect-square w-full rounded-2xl object-cover"
          />
          <div>
            <p className="label-eyebrow text-copper/90">The People Behind MSM</p>
            <blockquote className="font-display mt-6 text-2xl leading-snug font-medium italic sm:text-3xl">
              “Every load is weighed in front of the customer. That is how we built fourteen years
              of trust in this trade.”
            </blockquote>
            <p className="font-display mt-8 text-lg font-semibold">Mohammed Sihabuddin</p>
            <p className="text-muted-foreground">Owner, MSM Scrap</p>
            <p className="text-copper">14 Years in the Industry</p>
            <a
              href="#contact"
              className="font-display mt-6 inline-block text-sm font-semibold hover:text-copper"
            >
              Read our full story →
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}