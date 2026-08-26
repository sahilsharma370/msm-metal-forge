import { describe, expect, it } from "vitest";
import { COMPANY_WHATSAPP_DISPLAY, COMPANY_WHATSAPP_NUMBER, NAV_LINKS, WHATSAPP_URL } from "./site";

describe("NAV_LINKS", () => {
  it("labels the second link 'Services' and targets the #services anchor", () => {
    const services = NAV_LINKS.find((link) => link.label === "Services");
    expect(services).toBeDefined();
    expect(services?.href).toBe("#services");
    expect(NAV_LINKS.some((link) => link.label === "Materials")).toBe(false);
  });

  it("keeps Contact targeting the real footer/contact anchor", () => {
    expect(NAV_LINKS.find((link) => link.label === "Contact")?.href).toBe("#contact");
  });
});

describe("company WhatsApp destination", () => {
  it("uses the correct number in both digit and display form", () => {
    expect(COMPANY_WHATSAPP_NUMBER).toBe("971508491233");
    expect(COMPANY_WHATSAPP_DISPLAY).toBe("+971 50 849 1233");
  });

  it("builds the general public CTA with the correct number and a URL-encoded prefilled message", () => {
    expect(WHATSAPP_URL).toBe(
      "https://wa.me/971508491233?text=Hello%20MSM%20Scrap%2C%20I%E2%80%99d%20like%20to%20enquire%20about%20buying%20or%20selling%20scrap%20metal.",
    );
    expect(decodeURIComponent(WHATSAPP_URL.split("?text=")[1] ?? "")).toBe(
      "Hello MSM Scrap, I’d like to enquire about buying or selling scrap metal.",
    );
  });
});
