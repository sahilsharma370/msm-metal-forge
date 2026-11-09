import { useEffect, useRef, useState } from "react";
import { AlertCircle, Eye, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { OwnerLeadDetailFile } from "@/lib/owner/owner-lead-detail-contract";
import { requestOwnerLeadFileAccess, type OwnerLeadsTransportDeps } from "./owner-leads-transport";
import { formatByteSize } from "./owner-lead-format";

/**
 * CHECKPOINT C2J-D — mints and uses a 60-second private-file signed URL.
 * The URL lives in this component's own React state only — never
 * localStorage/sessionStorage/a URL search param — and is cleared the
 * instant the modal closes, the file/lead changes, this component
 * unmounts, or its own 60-second timer elapses (whichever comes first).
 * Never logged: no console.* call anywhere in this file references the
 * URL, and it is never passed to anything other than an <img src>/
 * window.open() call.
 */

type ViewerStatus = "idle" | "loading" | "ready" | "error";

export interface OwnerLeadFileViewerProps {
  readonly leadId: string;
  readonly file: OwnerLeadDetailFile;
  readonly deps: OwnerLeadsTransportDeps;
  readonly onUnauthorized: () => void;
}

const IMAGE_MIME_PREFIX = "image/";

export function OwnerLeadFileViewer({ leadId, file, deps, onUnauthorized }: OwnerLeadFileViewerProps) {
  const [status, setStatus] = useState<ViewerStatus>("idle");
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  // Separate from `status === "ready"` (which only means "the signed url
  // was minted"): "Loading photo…" must stay visible through the actual
  // image transfer/decode too, not just the mint, so this only flips once
  // the real <img> fires onLoad.
  const [imageLoaded, setImageLoaded] = useState(false);
  const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isImage = file.mimeType.startsWith(IMAGE_MIME_PREFIX);

  function clearSignedUrl() {
    if (expiryTimerRef.current) {
      clearTimeout(expiryTimerRef.current);
      expiryTimerRef.current = null;
    }
    setSignedUrl(null);
  }

  // Clears the in-memory URL and aborts any in-flight mint request whenever
  // the file/lead this viewer points at changes, and unconditionally on
  // unmount — both explicitly required.
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      clearSignedUrl();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, file.id]);

  async function handleOpen() {
    if (status === "loading") return; // guards against a double-click minting two signed URLs
    setStatus("loading");
    setImageLoaded(false);

    // PERF — the viewer dialog now opens immediately, before the signed-url
    // mint even starts (measured: minting + the actual image transfer can
    // together take well over a second on a real network — see the dialog
    // body's own per-image loading/error state below). Previously nothing
    // rendered at all until the whole round trip finished, which is what
    // made the View button look like it "waited" before doing anything.
    // Non-image files are unaffected: there is no dialog for them, and
    // window.open() below still only ever runs once the real URL exists.
    if (isImage) setIsModalOpen(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const result = await requestOwnerLeadFileAccess(leadId, file.id, deps, controller.signal);

    if (result.kind === "unauthorized") {
      setStatus("idle");
      onUnauthorized();
      return;
    }
    if (result.kind === "aborted") {
      setStatus("idle");
      return;
    }
    if (result.kind === "error") {
      setStatus("error");
      return;
    }

    setSignedUrl(result.data.url);
    setStatus("ready");
    expiryTimerRef.current = setTimeout(() => {
      clearSignedUrl();
      setIsModalOpen(false);
      setStatus("idle");
    }, result.data.expiresInSeconds * 1000);

    if (!isImage) {
      // PDFs/other documents: open directly in a new tab, never inline —
      // noopener,noreferrer so the opened tab cannot reach back into this
      // window (e.g. via window.opener) or leak this page's URL/referrer.
      window.open(result.data.url, "_blank", "noopener,noreferrer");
    }
  }

  function handleModalOpenChange(open: boolean) {
    setIsModalOpen(open);
    if (!open) {
      // The dialog can now be closed while the mint is still in flight
      // (it opens immediately, before that request resolves) — abort it
      // so a late response can never set state for a viewer the owner has
      // already dismissed.
      abortControllerRef.current?.abort();
      clearSignedUrl();
      setStatus("idle");
      setImageLoaded(false);
    }
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-[#080A1D]/50 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0">
            <p className="truncate text-sm text-foreground">{file.originalFilename}</p>
            <p className="text-xs text-muted-foreground">
              {file.mimeType} · {formatByteSize(file.byteSize)}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void handleOpen()}
          disabled={status === "loading"}
          aria-label={`View ${file.originalFilename}`}
          className="shrink-0 gap-1.5"
        >
          {status === "loading" ? (
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : (
            <Eye className="size-4" aria-hidden="true" />
          )}
          View
        </Button>
      </div>
      {status === "error" && !isImage ? (
        <p role="alert" className="mt-1 flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="size-3" aria-hidden="true" />
          Couldn't open this file. Please try again.
        </p>
      ) : null}

      {isImage ? (
        <Dialog open={isModalOpen} onOpenChange={handleModalOpenChange}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>{file.originalFilename}</DialogTitle>
            </DialogHeader>
            {status === "error" ? (
              <div role="alert" className="flex flex-col items-center gap-2 py-12 text-sm text-destructive">
                <AlertCircle className="size-5" aria-hidden="true" />
                Couldn't open this photo. Please close this and try again.
              </div>
            ) : (
              <>
                {!imageLoaded ? (
                  <div role="status" className="flex flex-col items-center gap-2 py-12 text-sm text-muted-foreground">
                    <Loader2 className="size-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    Loading photo…
                  </div>
                ) : null}
                {signedUrl ? (
                  // `sr-only` (not `hidden`/display:none) while the image
                  // itself is still loading/decoding: the <img> must stay
                  // in the DOM and start its real network fetch the moment
                  // the signed url exists (never delayed until the loading
                  // block above is removed), but nothing is painted — and
                  // it must stay discoverable (getByRole("img")) rather
                  // than excluded from the accessibility tree — until
                  // onLoad actually fires. onError here (a genuinely bad/
                  // expired/undecodable image response) is treated exactly
                  // like a failed signed-url mint: the same error state.
                  <img
                    src={signedUrl}
                    alt={file.originalFilename}
                    onLoad={() => setImageLoaded(true)}
                    onError={() => setStatus("error")}
                    className={imageLoaded ? "max-h-[70vh] w-full rounded-md object-contain" : "sr-only"}
                  />
                ) : null}
              </>
            )}
            <p className="text-xs text-muted-foreground">This link is temporary and stops working shortly after opening.</p>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
