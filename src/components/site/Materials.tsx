import { useState } from "react";
import copperAsset from "@/assets/material-copper.png.asset.json";
import scrapTexture from "@/assets/scrap-texture.jpg.asset.json";
import aluminium from "@/assets/material-aluminium.jpg";
import steel from "@/assets/material-steel.jpg";
import lead from "@/assets/material-lead.jpg";

const MATERIALS = [
  { name: "Copper", image: copperAsset.url },
  { name: "Aluminium", image: aluminium },
  { name: "Steel", image: steel },
  { name: "Lead", image: lead },
];

const TAGS = ["Fair pricing", "Certified weighing", "UAE-wide pickup"];

export function Materials() {
  const [active, setActive] = useState(0);
  const material = MATERIALS[active]!;

  return (
    <section id="materials" className="relative overflow-hidden bg-background py-28">
      {/* Ambient scrap-metal backdrop: heavily blurred and darkened */}
      <div className="pointer-events-none absolute inset-0">
        <img
          src={scrapTexture.url}
          alt=""
          aria-hidden="true"
          loading="lazy"
          className="h-full w-full scale-110 object-cover blur-[18px]"
        />
        <div className="absolute inset-0 bg-navy-deep/80" />
        <div className="absolute inset-0 bg-gradient-to-b from-background via-transparent to-background" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6">
        <p className="glass-panel glass-ring label-eyebrow inline-block rounded-full px-5 py-2 text-copper">
          Our Inventory
        </p>
        <h2 className="font-display mt-4 text-3xl font-semibold tracking-[0.02em] uppercase sm:text-4xl">
          What we trade
        </h2>

        <div className="mt-10 flex flex-wrap gap-3">
          {MATERIALS.map((m, i) => (
            <button
              key={m.name}
              type="button"
              onClick={() => setActive(i)}
              className={`font-display rounded-full border px-6 py-2.5 text-sm font-semibold transition-colors ${
                i === active
                  ? "border-copper/70 bg-copper text-primary-foreground shadow-[0_10px_30px_-12px_oklch(0.583_0.135_45.5/0.9)]"
                  : "glass-panel glass-ring border-transparent text-foreground hover:text-copper"
              }`}
            >
              {m.name}
            </button>
          ))}
        </div>

        <div className="mt-12 grid items-center gap-12 lg:grid-cols-2">
          <img
            src={material.image}
            alt={`${material.name} scrap handled by MSM Scrap in the UAE`}
            loading="lazy"
            width={1280}
            height={960}
            className="aspect-[4/3] w-full rounded-2xl object-cover"
          />
          <div
            key={material.name}
            className="glass-panel glass-ring animate-material-zoom rounded-3xl p-8 sm:p-10"
          >
            <h3 className="font-display text-3xl font-bold text-foreground">{material.name}</h3>
            <p className="font-display mt-5 max-w-xl text-base font-medium text-foreground/90 sm:text-lg">
              We source, weigh, and process {material.name.toLowerCase()} from factories, workshops,
              and demolition sites across the UAE, ensuring fair pricing and reliable pickup.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {TAGS.map((tag) => (
                <span
                  key={tag}
                  className="glass-panel glass-ring font-display rounded-full px-4 py-2 text-sm font-semibold text-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}