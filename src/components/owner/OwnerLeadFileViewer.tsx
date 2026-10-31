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

    if (isImage) {
      setIsModalOpen(true);
    } else {
      // PDFs/other documents: open directly in a new tab, never inline —
      // noopener,noreferrer so the opened tab cannot reach back into this
      // window (e.g. via window.opener) or leak this page's URL/referrer.
      window.open(result.data.url, "_blank", "noopener,noreferrer");
    }
  }

  function handleModalOpenChange(open: boolean) {
    setIsModalOpen(open);
    if (!open) {
      clearSignedUrl();
      setStatus("idle");
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
      {status === "error" ? (
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
            {signedUrl ? (
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
              <img src={signedUrl} alt={file.originalFilename} className="max-h-[70vh] w-full rounded-md object-contain" />
            ) : null}
            <p className="text-xs text-muted-foreground">This link is temporary and stops working shortly after opening.</p>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
