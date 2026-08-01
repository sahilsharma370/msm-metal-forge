# MSM Metal Forge

Build a premium, professional B2B homepage for "MSM Scrap" (Mohammed Sihabuddin Metal Scrap Trading LLC), a metal scrap trading company based in Sharjah, UAE. This is a real client project — treat it like a serious industrial trading company's website, not a playful consumer app.

STACK
Next.js + Tailwind CSS + Supabase (for future materials/leads tables — not needed for this static homepage yet, just use clean component structure that could later pull from a database).

BRAND
- Navy: #14213D
- Copper: #C1622E
- Typography: a clean modern grotesque sans-serif (similar to Neue Haas Grotesk / General Sans / Plus Jakarta Sans for headings, Inter for body). NOT extended/wide typography. Section labels in uppercase with wide letter-spacing; headlines in normal sentence case.
- Tone: professional, industrial, trustworthy — not playful, not artistic. This is a functional B2B trust-building site.
- Logo: attached separately (MSM wordmark, navy/copper diagonal-split letters, "SCRAP" subtitle beneath). Do not redesign or recreate the logo — use it as provided, and never place it inside a white box/card — it should sit directly on whatever background it's placed on.

GLOBAL BACKGROUND TREATMENT
Use a subtle dot-pattern texture on navy sections (fine dots, low opacity, soft copper glow radiating from one focal point) instead of flat navy — this should feel like a premium industrial surface, not a flat color block. Keep dot rendering as a single clean layer (no doubled/overlapping dot layers).

GLASSMORPHISM — do this properly, it matters a lot
Any glass-effect element (nav bar, stat cards, the About/Owner card) needs:
- backdrop blur (strong enough to visibly soften what's behind it, not a token blur)
- a subtle background tint with increased saturation, not flat gray-transparent
- a thin 1px gradient border ring that glows white-to-copper
- a soft light-refraction highlight along the top edge (inset light line)
- a soft outer/inner shadow for depth
Reference feel: real frosted glass — like iOS control center panels or premium SaaS dashboards — not a flat semi-transparent box.

SECTIONS

1. Header (sticky, always glassmorphic per above, even at the top of the page — semi-transparent navy, blurred, subtle bottom border glow)
- Logo on left (no white box background)
- Nav links: Home, Materials, About, Contact
- Right side: "Get Quote" copper pill button + WhatsApp icon button

2. Hero
- Small badge in the TOP-LEFT corner of the hero (not centered, not in a circle): large "14+" in a subtle metallic copper gradient, "YEARS OF TRUST" in small uppercase letter-spaced text below it, with a thin copper underline rule
- Eyebrow text centered: "SHARJAH · UNITED ARAB EMIRATES"
- MSM logo centered below the eyebrow (modest size, not oversized, no redundant "14 years" repeated near it)
- Headline: "Trusted metal trading across the UAE" — with "metal trading" styled in a subtle brushed-copper gradient text effect (light highlight in the middle, darker at the edges, suggesting metallic shine)
- Subtext: "We buy, sell, export, and import all metal scrap — copper, aluminium, steel, and lead — with transparent weighing and UAE-wide pickup."
- Two buttons: "Get Quote →" (solid copper pill) and "WhatsApp →" (outlined pill)
- Below that: a thin-line weighing-scale icon with a subtle continuous up-and-down floating animation, with "100% TRANSPARENT WEIGHING" text above it in small caps

3. Trust stat bar (4 glassmorphic cards, per the glass spec above)
- 14+ / Years Established
- UAE-Wide / Pickup Coverage
- 100% / Transparent Weighing
- 500+ / Happy Customers

4. "What We Do" section
- Eyebrow: "OUR SERVICES"
- Headline: "A full-cycle scrap trading partner"
- A hub-and-spoke diagram: center is a HEXAGON shape (not a circle — match the brand's hex-bolt visual language from the logo), containing a thin-line hex-bolt icon and the text "What We Do" (with "Do" in copper)
- Four thick beam-style copper lines radiate out from the hexagon (up, down, left, right) — styled like steel beams, not thin plain lines, with a soft industrial glow along them
- At the end of each beam: an angular diagonal-cut tag (matching the logo's diagonal-cut lettering style, NOT a rounded pill) labeled Buy, Sell, Export, Import

5. Materials showcase ("What we trade")
- Eyebrow: "OUR INVENTORY", headline "What we trade"
- Simple clickable tabs: Copper, Aluminium, Steel, Lead
- Each tab shows: a real photo of that material/industrial process (use relevant stock imagery — factory/scrapyard/industrial themed, moody and premium, not generic clip-art), a "MATERIAL 0X" label, material name, a short description ("We source, weigh, and process [material] from factories, workshops, and demolition sites across the UAE, ensuring fair pricing and reliable pickup."), and three small tags: Fair pricing / Certified weighing / UAE-wide pickup

6. About/Owner teaser
- Glassmorphic card (per spec above) on a navy dot-pattern background
- Owner photo placeholder (square, rounded corners) on one side
- "THE PEOPLE BEHIND MSM" eyebrow, an italic quote from the owner, name "Mohammed Sihabuddin", "Owner, MSM Scrap", "14 Years in the Industry", and a "Read our full story →" link

7. Contact CTA + Footer
- Copper full-width banner: "LET'S TRADE" eyebrow, "Have scrap to sell? Get in touch" headline, Get Quote + WhatsApp buttons
- Navy footer: logo + tagline, Quick Links (Home/Materials/About/Contact), Contact Info (phone numbers, email ms.scrap80@gmail.com, address "Industrial Area 10, Sharjah, UAE"), Business Hours (Saturday–Thursday 7 AM–7 PM, Friday by appointment), copyright line

GENERAL RULES
- Flat design, no unnecessary gradients except where specified (metallic text, glass borders)
- Generous whitespace, mobile-responsive
- No entrance/intro animations needed — sections can render in their final static state, except: the "What We Do" beam-reveal animation should trigger once automatically when the section scrolls into view (no replay button), and the floating scale icon should animate continuously
- This should read as a serious, established industrial trading company — not a startup, not a creative portfolio

NEXT CHANGE I MADE YOU DO :
Refine the current homepage with these specific changes:

HEADER

Remove whatever is in the top-right corner of the header besides the nav links and CTA — replace that space with a compact "14+ Years" badge (small copper number + "Years" label, no circle).

The glassmorphic pill/bubble background on the nav bar should wrap ONLY the nav links (Home, Materials, About, Contact) tightly — not the full header width. Keep it as a distinct floating glass pill, separate from the logo on the left and the Get Quote/badge on the right.

BACKGROUND DOT INTERACTION

Remove the current hover glow effect on the dot background.

Replace it with a smooth, premium "interactive dot grid" effect: dots near the cursor should subtly shift position and glow softly as the mouse moves nearby, with smooth easing (not abrupt) — the standard interactive dot-grid pattern used in premium SaaS/portfolio sites.

TYPOGRAPHY — use this exact system

Headings: "General Sans" (fallback: "Plus Jakarta Sans") from Google Fonts / Fontshare

Body: "Inter"

H1 (hero headline): General Sans Bold, 56–64px, normal sentence case (not all-caps)

H2 (section titles like "What We Do"): General Sans SemiBold, 32–40px, UPPERCASE with slight letter-spacing

Body text: Inter Regular, 16–18px, normal case

Buttons/CTA text: General Sans SemiBold, 14–16px, uppercase, wide letter-spacing

TRUST STAT NUMBERS

Add a count-up animation to the stat numbers (14+, 500+, 100%) — they should animate from 0 up to their final value once, triggered when the trust bar scrolls into view.

"WHAT WE DO" HEXAGON — remove the bolt icon

Remove the hex-bolt icon inside the center hexagon.

Instead, as the user scrolls this section into view, thin metallic copper lines should originate from the "What We Do" text itself and draw outward toward each tag (Buy/Sell/Export/Import), appearing one at a time in a clockwise order (e.g., Buy → Export → Sell → Import, or whatever clockwise sequence matches their current positions), each line drawing in sync with scroll progress rather than all appearing at once.

THEN :
Refine the homepage with these changes:

HEADER LAYOUT — exactly three elements, nothing else The header row should contain ONLY these three elements, evenly spaced left/center/right:

LEFT: a compact "14+ Years" badge (copper "14+" number, small "Years of Trust" label below, matching the hero badge style)

CENTER: the glassmorphic nav pill (Home / Materials / About / Contact)

RIGHT: the "Get Quote" button, alone Remove the small MSM logo from the header entirely (it is not needed here) and remove any other "14+ Years" text that currently appears elsewhere in the header (e.g. next to Get Quote) — the badge should exist in exactly one place: the top-left, as described above. The large centered MSM logo inside the hero section itself stays exactly as it is — this change only affects the header/nav row, not the hero body.

DOT BACKGROUND POLISH

The dot pattern and glow effect are good — increase the intensity/prominence of the glow slightly so it feels more dominant/atmospheric, not too subtle.

Fix the center content alignment in the hero — the eyebrow text, logo, headline, and subtext should all be precisely horizontally centered on the page (currently slightly off-center).

HERO ENTRANCE ANIMATION (one-time, on page load)

On load: show a navy+copper diagonal split-panel transition — two diagonal panels wipe away/reveal, synced with the MSM logo doing a subtle cut-reveal as the panels clear, then the logo settles into its centered position.

After the panels clear: header fades in from the top, followed by the "14+ Years" badge fading in (top-left, per the header change above).

Headline, subtext, and CTA buttons (Get Quote / WhatsApp) fade/slide in after that, in sequence.

The weighing-beam icon near the bottom of the hero should have a subtle settle-in animation as it appears, then continue its idle floating animation as already implemented.

This should be a smooth, one-time entrance sequence — not repeating on scroll, only on initial page load.

MATERIALS SHOWCASE — confirm current approach

Keep the current simple click-to-switch tabs (Copper/Aluminium/Steel/Lead) as the V1 approach — this is intentional, do not change it to a scroll-based showcase yet. Placeholder descriptions are fine for now until final material details are confirmed later.

NOW THE LATEST ONES WHICH IS NOT IN THE POHOTOS :
Two changes:

"WHAT WE DO" — REDESIGN AS METAL NUT-BOLT WITH ENERGY LINES Replace the current hexagon-shaped center element with this new layout:

At the top, centered: the heading text "What We Do" (with "Do" in copper, as before).

Below the heading: a realistic-looking metal HEX NUT/BOLT graphic as the visual anchor — rendered with a brushed-metal/chrome look with a subtle copper-navy metallic gradient and highlight (like a real machined bolt catching light), not a flat icon.

From this bolt, thin glowing metallic lines (like electric/energy filament lines — bright copper core with a soft outer glow, similar to a spark or current running through metal) extend outward toward each of the four tags (Buy / Sell / Export / Import), positioned around it as before (top, bottom, left, right).

Animation: as the user scrolls this section into view, the lines should draw outward from the bolt one at a time in a clockwise sequence (e.g. Buy → Export → Sell → Import), each line appearing to "ignite" and glow as it draws, synced with scroll position.

Keep the four angular diagonal-cut tags (Buy/Sell/Export/Import) as they currently are.

HERO ENTRANCE ANIMATION — proper metal-cut transition with correct brand colors Refine the on-load entrance sequence:

Two diagonal panels should wipe away to reveal the hero — but instead of flat solid color panels, give them a brushed-metal transition look: a navy panel and a copper panel, each with a subtle metallic sheen/gradient (like light glinting across brushed steel/copper as it moves), not flat solid fills. Match the exact tone and texture feel of the attached navy and copper reference images — use only these two brand tones, no other colors.

As the panels clear, the MSM logo should have a synced "cut-reveal" — as if the diagonal wipe is cutting the logo into view precisely as the panel passes over it — then the logo settles into its centered position.

Sequence after the panels clear: header fades in from the top → "14+ Years" badge fades in (top-left, per current layout — keep it here, do not move it) → headline fades/slides in ("14 Years of Trusted Metal Trading in the UAE", with "14 Years" in a copper metallic gradient) → subtext fades in → CTA buttons (Get Quote / WhatsApp) fade in → the weighing-scale icon settles in with a subtle bounce/settle motion, then continues its idle float animation as already implemented.

This is a one-time sequence on initial page load only, not repeating on scroll.


I HAVE ALSO ATTACHED RIHT NOW STATUS OF WEBSITE I WANT THE LAST TWO CHANGES NUT MAKE SURE EVERYTHING ELSE IS EXACT SAME

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/fdf888a5-94dc-4a19-a8d5-a1bb940e37cb).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
