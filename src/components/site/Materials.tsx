import { useState } from "react";
import copperAsset from "@/assets/material-copper.png.asset.json";
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
    <section id="materials" className="bg-background py-28">
      <div className="mx-auto max-w-7xl px-6">
        <p className="label-eyebrow text-copper/90">Our Inventory</p>
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
                  ? "border-copper bg-copper text-primary-foreground"
                  : "border-border text-foreground/80 hover:border-copper/60"
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
          <div>
            <h3 className="font-display text-3xl font-bold">{material.name}</h3>
            <p className="mt-5 max-w-xl text-base text-muted-foreground sm:text-lg">
              We source, weigh, and process {material.name.toLowerCase()} from factories, workshops,
              and demolition sites across the UAE, ensuring fair pricing and reliable pickup.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {TAGS.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-border px-4 py-2 text-sm text-foreground/85"
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