import logoWhite from "@/assets/msm-logo-white.png";
import {
  ADDRESS,
  EMAIL,
  NAV_LINKS,
  PHONE_PRIMARY,
  PHONE_SECONDARY,
  WHATSAPP_URL,
} from "@/lib/site";

export function ContactFooter() {
  return (
    <>
      <section id="contact" className="bg-copper py-24 text-center">
        <div className="mx-auto max-w-4xl px-6">
          <p className="label-eyebrow text-primary-foreground/80">Let's Trade</p>
          <h2 className="font-display mt-4 text-3xl font-semibold tracking-[0.02em] text-primary-foreground uppercase sm:text-4xl">
            Have scrap to sell? Get in touch
          </h2>
          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <a
              href={`mailto:${EMAIL}`}
              className="font-display rounded-full bg-navy px-7 py-3.5 text-sm font-semibold tracking-[0.14em] text-foreground uppercase"
            >
              Get Quote
            </a>
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noreferrer"
              className="font-display rounded-full border border-primary-foreground/70 px-7 py-3.5 text-sm font-semibold tracking-[0.14em] text-primary-foreground uppercase"
            >
              WhatsApp
            </a>
          </div>
        </div>
      </section>

      <footer className="bg-navy-deep py-20">
        <div className="mx-auto grid max-w-7xl gap-12 px-6 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <img
              src={logoWhite}
              alt="MSM Scrap"
              loading="lazy"
              width={924}
              height={347}
              className="w-40"
            />
            <p className="mt-4 text-sm text-muted-foreground">
              Mohammed Sihabuddin Metal Scrap Trading LLC — buying, selling, exporting and importing
              metal scrap across the UAE.
            </p>
          </div>
          <div>
            <p className="label-eyebrow text-[0.65rem] text-muted-foreground">Quick Links</p>
            <ul className="mt-5 space-y-3 text-sm">
              {NAV_LINKS.map((link) => (
                <li key={link.label}>
                  <a href={link.href} className="hover:text-copper">
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="label-eyebrow text-[0.65rem] text-muted-foreground">Contact Info</p>
            <ul className="mt-5 space-y-3 text-sm">
              <li>{PHONE_PRIMARY}</li>
              <li>{PHONE_SECONDARY}</li>
              <li>
                <a href={`mailto:${EMAIL}`} className="hover:text-copper">
                  {EMAIL}
                </a>
              </li>
              <li>{ADDRESS}</li>
            </ul>
          </div>
          <div>
            <p className="label-eyebrow text-[0.65rem] text-muted-foreground">Business Hours</p>
            <ul className="mt-5 space-y-3 text-sm">
              <li>Saturday – Thursday: 7 AM – 7 PM</li>
              <li>Friday: By appointment</li>
            </ul>
          </div>
        </div>
        <div className="mx-auto mt-16 max-w-7xl border-t border-border px-6 pt-8 text-sm text-muted-foreground">
          © 2026 Mohammed Sihabuddin Metal Scrap Trading LLC. All rights reserved.
        </div>
      </footer>
    </>
  );
}