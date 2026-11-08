/**
 * CHECKPOINT (approved email designs) — shared, pure, table-safe HTML
 * building blocks for both transactional email templates
 * (owner-notification-email.ts / customer-receipt-email.ts). No I/O, no
 * Supabase, no provider — every export here is a plain function from
 * already-validated strings to an HTML/text fragment, matching this
 * module family's own "pure, deps-free" convention.
 *
 * Email-client-safe by construction: table-based layout only (no flexbox/
 * grid, no external stylesheet — every rule is inlined), no SVG (Outlook
 * desktop has zero SVG support), a single raster PNG logo with explicit
 * width/height attributes and alt text (so a client that blocks remote
 * images — the common default — still shows a readable fallback instead
 * of a broken-image icon or a collapsed layout).
 */

/** The exact two-color brand system both approved designs use — never a third accent color, never a CSS variable (email clients do not support `var()`). */
export const EMAIL_NAVY = "#080A1D";
export const EMAIL_COPPER = "#BA5D2D";
export const EMAIL_GRAY_LABEL = "#6B7280";
export const EMAIL_GRAY_HAIRLINE = "#E5E7EB";
export const EMAIL_GRAY_FOOTER = "#9CA3AF";
export const EMAIL_OUTER_BG = "#F0F1F3";
export const EMAIL_CARD_BG = "#FFFFFF";

/** Standard email body width — compact card width, still comfortably readable on desktop. */
export const EMAIL_WIDTH_PX = 560;

/** Standard HTML entity escaping — the only thing standing between a customer-controlled string and the html body. Shared by both templates so there is exactly one escaping implementation, never two that could drift. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Strips CR/LF so a customer-controlled value can never inject a second email header — applied to every value that ends up in subject/from/to/reply-to anywhere in this pipeline. */
export function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/** Renders a block of free-text as escaped, paragraph-broken HTML — the only place customer newlines become markup, and only ever inside the body, never a header. */
export function escapeMultilineHtml(value: string): string {
  return escapeHtml(value)
    .split(/\r?\n/)
    .map((line) => line || "&nbsp;")
    .join("<br>");
}

export function humanizeCode(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Deliberately compact, lowercase display form ("50 kg", never "50 Kg") —
 * matches the approved designs and this schema's own QUOTE_UNITS/
 * UNIT_LABELS convention (src/components/site/quote/quote-options.ts)
 * without importing that client-only module from this deps-free email
 * path. humanizeCode's title-casing is correct for snake_case codes like
 * "clean_separated" but wrong for a unit abbreviation — shared here so
 * both templates' quantity formatting agree, rather than each keeping its
 * own copy.
 */
const EMAIL_UNIT_LABELS: Record<string, string> = {
  kg: "kg",
  tonnes: "tonnes",
  pieces: "pieces",
  load: "load",
  other: "other",
};

export function unitLabel(unit: string): string {
  return EMAIL_UNIT_LABELS[unit] ?? humanizeCode(unit);
}

/**
 * The real repository logo asset (src/assets/msm-logo.svg — untouched,
 * website logo unaffected), recolored and rasterized to an email-only PNG
 * (see public/email-logo-msm-copper.png): the SVG's own "ink" paths
 * (originally #FEFEFE) become solid muted copper (#BC6C3B); the SVG's own
 * negative-space/cutout paths (the small badge ring, the SCRAP letters'
 * counters — originally #080A1D/#14213D) are punched to true transparency
 * rather than filled any color, preserving the mark's real holes instead
 * of a background-matching solid guess. Background is otherwise fully
 * transparent — no rectangle, halo, outline, gradient or shadow (an
 * earlier solid-navy-card version looked disconnected from the email
 * card; before that, a navy-ink-on-transparent version and its
 * thin-white-halo variant were both illegible in real Gmail iPhone dark
 * mode). ~8% margin on every side (geometry otherwise byte-identical to
 * the source SVG, same proportions) so the artwork never touches the
 * canvas edge. New filename so no client/CDN serves a stale cached copy
 * under this URL.
 */
export const EMAIL_LOGO_URL = "https://msmscrap.com/email-logo-msm-copper.png";
/** Compact header size — proportional to the real 520x185 asset (120/43 ≈ 520/185), never cropped or redrawn. */
export const EMAIL_LOGO_DISPLAY_WIDTH = 120;
export const EMAIL_LOGO_DISPLAY_HEIGHT = 43;
export const EMAIL_LOGO_ALT = "MSM Scrap";

/**
 * The logo header row — the navy logo on the card's own white background,
 * matching both approved designs. `eyebrowHtml`, when supplied (the owner
 * design's right-aligned "ENQUIRY / {date}" eyebrow), renders in the same
 * row as the logo via a two-column table; omitted entirely for the
 * customer design, whose eyebrow is its own row further down. If the
 * recipient's client blocks remote images, the `alt` text "MSM Scrap"
 * renders in the logo's place, so the header never collapses to an empty
 * or broken-image box.
 */
export function logoHeaderHtml(eyebrowHtml?: string): string {
  // height:auto is load-bearing, not decorative: the HTML height="93"
  // attribute otherwise wins over a shrunken rendered width (from
  // max-width:100%, e.g. when the sibling nowrap eyebrow cell claims
  // space at a narrow viewport), vertically squashing the logo. With
  // height:auto the browser derives height from the (possibly shrunken)
  // rendered width instead, preserving the original PNG's aspect ratio at
  // any width — the image never renders wider or taller than its own
  // intrinsic 520x185 asset, only smaller, proportionally.
  const logoImg = `<img src="${EMAIL_LOGO_URL}" width="${EMAIL_LOGO_DISPLAY_WIDTH}" height="${EMAIL_LOGO_DISPLAY_HEIGHT}" alt="${EMAIL_LOGO_ALT}" style="display:block;border:0;outline:none;text-decoration:none;max-width:100%;height:auto;" />`;
  const inner = eyebrowHtml
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
      `<td align="left" valign="middle" style="width:${EMAIL_LOGO_DISPLAY_WIDTH}px;">${logoImg}</td>` +
      `<td align="right" valign="middle">${eyebrowHtml}</td>` +
      `</tr></table>`
    : logoImg;
  return `<tr><td style="padding:20px 24px 0;" align="left">${inner}</td></tr>`;
}

/**
 * One label/value row inside a hairline-separated table, matching the
 * owner design's sentence-case label style. `last` omits the bottom
 * hairline. Label: 12px/500 muted grey. Value: 14px/600 navy — medium
 * weight, not bold, bold is reserved for headings/reference/important
 * values. word-break/overflow-wrap on the value cell is load-bearing, not
 * decorative: a long unbreakable value (a long email address is the real
 * case this guards — no spaces for the browser to wrap at otherwise) can
 * force the shared outer body table wider than its own container, which
 * cascades into every other row/block in the same table overflowing a
 * narrow viewport too — not just the one long value's own cell.
 */
export function tableRowHtml(label: string, value: string, last = false): string {
  const borderStyle = last ? "" : `border-bottom:1px solid ${EMAIL_GRAY_HAIRLINE};`;
  return (
    `<tr>` +
    `<td style="padding:8px 0;${borderStyle}color:${EMAIL_GRAY_LABEL};font-size:12px;font-weight:500;vertical-align:top;width:42%;">${escapeHtml(label)}</td>` +
    `<td style="padding:8px 0;${borderStyle}color:${EMAIL_NAVY};font-size:14px;font-weight:600;vertical-align:top;word-break:break-word;overflow-wrap:break-word;">${value}</td>` +
    `</tr>`
  );
}

/** Same row shape, but with the customer design's uppercase letter-spaced label style ("REQUEST", "MATERIAL") instead of the owner design's sentence case — one of the deliberate uppercase-label exceptions, kept restrained (small size, modest letter-spacing, never full bold). Value shares the same 14px/600 treatment as tableRowHtml for consistency across both templates, including the same word-break/overflow-wrap safety. */
export function tableRowHtmlUppercaseLabel(label: string, value: string, last = false): string {
  const borderStyle = last ? "" : `border-bottom:1px solid ${EMAIL_GRAY_HAIRLINE};`;
  return (
    `<tr>` +
    `<td style="padding:8px 0;${borderStyle}color:${EMAIL_GRAY_LABEL};font-size:11px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;vertical-align:top;width:46%;">${escapeHtml(label)}</td>` +
    `<td style="padding:8px 0;${borderStyle}color:${EMAIL_NAVY};font-size:14px;font-weight:600;vertical-align:top;word-break:break-word;overflow-wrap:break-word;">${value}</td>` +
    `</tr>`
  );
}

/**
 * The reference-number block: a compact light-neutral card with a subtle
 * copper left edge, a small muted uppercase label, and the reference
 * itself (18px/700 — one of the few places bold is reserved for).
 * `table-layout:fixed` is load-bearing, not decorative: without it, a long
 * unbroken reference string can force this table wider than its own
 * `width:100%`/parent constraint (tables grow to fit unbreakable content by
 * default), overflowing a 320/390px viewport even with word-break set on
 * the text itself — fixed layout forces the single column (and therefore
 * the text inside it) to respect the table's own width, which is what lets
 * word-break/overflow-wrap actually wrap a long reference instead of the
 * whole card growing past the screen. Both wrap properties are set for
 * cross-client safety (word-break is the older/more broadly supported
 * name; overflow-wrap is the current standard name for the same behavior).
 */
export function referenceBlockHtml(reference: string): string {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;"><tr>` +
    `<td style="background-color:#F7F7F8;border-left:3px solid ${EMAIL_COPPER};border-radius:4px;padding:10px 14px;">` +
    `<div style="color:${EMAIL_GRAY_LABEL};font-size:10px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">REFERENCE</div>` +
    `<div style="color:${EMAIL_NAVY};font-size:18px;font-weight:700;margin-top:2px;word-break:break-word;overflow-wrap:break-word;">${escapeHtml(reference)}</div>` +
    `</td></tr></table>`
  );
}

/** A section heading ("MATERIAL & LOGISTICS" / "CUSTOMER CONTACT") — one of the deliberate uppercase-label exceptions: small, clearly separated by its own margin, restrained letter-spacing, 700 (never 800). */
export function sectionHeadingHtml(label: string): string {
  return `<div style="color:${EMAIL_NAVY};font-size:12px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;margin:18px 0 8px;">${escapeHtml(label)}</div>`;
}

/**
 * Shared outer document chrome: the full HTML wrapper, outer background
 * table, and the single inner 600px white card table both templates
 * render their own content inside. `bodyRowsHtml` is everything between
 * the logo header and the footer, already-composed `<tr>` markup.
 */
export function emailDocumentHtml(title: string, bodyRowsHtml: string, footerHtml: string, headerHtml: string = logoHeaderHtml()): string {
  return (
    `<!doctype html><html lang="en"><head><meta charSet="utf-8"/>` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"/>` +
    `<title>${escapeHtml(title)}</title></head>` +
    `<body style="margin:0;padding:0;background-color:${EMAIL_OUTER_BG};font-family:Arial,Helvetica,sans-serif;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${EMAIL_OUTER_BG};">` +
    `<tr><td align="center" style="padding:20px 12px;">` +
    `<table role="presentation" width="${EMAIL_WIDTH_PX}" cellpadding="0" cellspacing="0" border="0" style="max-width:${EMAIL_WIDTH_PX}px;width:100%;background-color:${EMAIL_CARD_BG};border-radius:12px;overflow:hidden;">` +
    headerHtml +
    `<tr><td style="padding:0 24px 24px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${bodyRowsHtml}</table>` +
    `</td></tr>` +
    `<tr><td style="padding:0 24px 20px;">${footerHtml}</td></tr>` +
    `</table>` +
    `</td></tr>` +
    `</table>` +
    `</body></html>`
  );
}

/** The shared footer block: a hairline rule, "MSM Scrap · Sharjah, UAE", and a secondary line stacked beneath it — the owner design's own treatment (second line e.g. "Owner notification"). Restrained: 12px/400 throughout, one subtle separator. */
export function footerHtml(secondLineHtml: string): string {
  return (
    `<div style="border-top:1px solid ${EMAIL_GRAY_HAIRLINE};padding-top:14px;">` +
    `<div style="color:${EMAIL_NAVY};font-size:12px;font-weight:400;">MSM Scrap <span style="color:${EMAIL_GRAY_FOOTER};font-weight:400;">&middot; Sharjah, UAE</span></div>` +
    secondLineHtml +
    `</div>`
  );
}

/** The customer design's own footer treatment: "MSM Scrap · Sharjah, UAE" and a right-aligned second element share one line (a two-column table, not a stacked div — the only email-safe way to right-align a sibling against left-aligned text at a fixed width). Restrained: 12px/400 throughout, one subtle separator. */
export function footerHtmlInline(rightHtml: string): string {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${EMAIL_GRAY_HAIRLINE};">` +
    `<tr>` +
    `<td style="padding-top:14px;color:${EMAIL_NAVY};font-size:12px;font-weight:400;" align="left" valign="middle">MSM Scrap <span style="color:${EMAIL_GRAY_FOOTER};font-weight:400;">&middot; Sharjah, UAE</span></td>` +
    `<td style="padding-top:14px;" align="right" valign="middle">${rightHtml}</td>` +
    `</tr></table>`
  );
}
