// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { QuotePhotoPicker } from "./QuotePhotoPicker";
import type { QuoteLocalFile } from "./quote-schema";

beforeAll(() => {
  if (!URL.createObjectURL) {
    URL.createObjectURL = () => "blob:fake";
  }
  if (!URL.revokeObjectURL) {
    URL.revokeObjectURL = () => undefined;
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function image(name: string, sizeBytes = 1024): File {
  const file = new File([new Uint8Array(sizeBytes)], name, { type: "image/png" });
  return file;
}

function existingFile(name: string): QuoteLocalFile {
  return { id: name, file: image(name), previewUrl: "", name, size: 1024 };
}

function Harness({ initial = [], maxFiles = 5 }: { initial?: QuoteLocalFile[]; maxFiles?: number }) {
  const [files, setFiles] = useState<QuoteLocalFile[]>(initial);
  return (
    <QuotePhotoPicker
      title="Add photos"
      browseLabel="Browse"
      acceptLine="JPG, PNG or WebP, up to 8MB"
      countLabel="photos"
      files={files}
      onChange={setFiles}
      maxFiles={maxFiles}
    />
  );
}

describe("QuotePhotoPicker — native picker attributes", () => {
  it("never forces the camera — the file input has no capture attribute", () => {
    render(<Harness />);
    const input = screen.getByLabelText("Add photos", { selector: "input" });
    expect(input).not.toHaveAttribute("capture");
  });

  it("allows selecting multiple files at once", () => {
    render(<Harness />);
    const input = screen.getByLabelText("Add photos", { selector: "input" });
    expect(input).toHaveAttribute("multiple");
  });
});

describe("QuotePhotoPicker — selection limit (5 total, not 5 per selection)", () => {
  it("accepts a full-capacity selection in one go", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText("Add photos", { selector: "input" });
    const files = ["a.png", "b.png", "c.png", "d.png", "e.png"].map((n) => image(n));

    await user.upload(input, files);

    expect(screen.getByText("5 of 5 photos")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("partial capacity: adds only the remaining slots and keeps existing photos", async () => {
    const user = userEvent.setup();
    const initial = [existingFile("existing-1.png"), existingFile("existing-2.png"), existingFile("existing-3.png")];
    render(<Harness initial={initial} />);
    const input = screen.getByLabelText("Add photos", { selector: "input" });
    const incoming = ["new-1.png", "new-2.png", "new-3.png"].map((n) => image(n));

    await user.upload(input, incoming);

    // 3 existing + only 2 of the 3 new ones fit (max 5) — existing files are
    // never dropped to make room for new ones.
    expect(screen.getByText("5 of 5 photos")).toBeInTheDocument();
    expect(screen.getByText(/1 exceeded the 5-photo limit/)).toBeInTheDocument();
  });

  it("exceeding five in a single selection from empty: adds 5, rejects the rest, loses nothing", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText("Add photos", { selector: "input" });
    const incoming = ["a.png", "b.png", "c.png", "d.png", "e.png", "f.png", "g.png"].map((n) => image(n));

    await user.upload(input, incoming);

    expect(screen.getByText("5 of 5 photos")).toBeInTheDocument();
    expect(screen.getByText(/5 of 7 selected files were added/)).toBeInTheDocument();
    expect(screen.getByText(/2 exceeded the 5-photo limit/)).toBeInTheDocument();
  });

  it("already at capacity: a further selection is rejected outright with the clear limit error, no silent loss", async () => {
    const user = userEvent.setup();
    const initial = [1, 2, 3, 4, 5].map((n) => existingFile(`existing-${n}.png`));
    render(<Harness initial={initial} />);

    // At capacity, the picker tile itself is not rendered (atCapacity hides
    // it) — the input still exists in the DOM for programmatic access.
    const input = screen.getByLabelText("Add photos", { selector: "input" });
    await user.upload(input, [image("one-more.png")]);

    expect(screen.getByText("5 of 5 photos")).toBeInTheDocument();
    expect(screen.getByText("You can upload up to 5 photos. Remove one to add another.")).toBeInTheDocument();
  });
});
