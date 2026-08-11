import { useId, useRef, useState } from "react";
import { Paperclip, Plus, UploadCloud, X } from "lucide-react";
import type { QuoteLocalFile } from "./quote-schema";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ACCEPTED_TYPES_WITH_PDF = [...ACCEPTED_TYPES, "application/pdf"];
const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024;

interface QuotePhotoPickerProps {
  title: string;
  browseLabel: string;
  acceptLine: string;
  countLabel: string;
  files: QuoteLocalFile[];
  onChange: (files: QuoteLocalFile[]) => void;
  maxFiles: number;
  allowPdf?: boolean;
}

function createLocalFile(file: File): QuoteLocalFile {
  return {
    id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
    file,
    previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : "",
    name: file.name,
    size: file.size,
  };
}

export function QuotePhotoPicker({
  title,
  browseLabel,
  acceptLine,
  countLabel,
  files,
  onChange,
  maxFiles,
  allowPdf = false,
}: QuotePhotoPickerProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [dragActive, setDragActive] = useState(false);
  const acceptedTypes = allowPdf ? ACCEPTED_TYPES_WITH_PDF : ACCEPTED_TYPES;
  const singularNoun = allowPdf ? "file" : "photo";

  function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;

    const incoming = Array.from(fileList);
    const remainingSlots = maxFiles - files.length;

    if (remainingSlots <= 0) {
      setError(`You can upload up to ${maxFiles} ${singularNoun}s. Remove one to add another.`);
      return;
    }

    const accepted: File[] = [];
    let rejectedType = 0;
    let rejectedSize = 0;
    for (const file of incoming) {
      if (!acceptedTypes.includes(file.type)) {
        rejectedType += 1;
        continue;
      }
      if (file.size > MAX_FILE_SIZE_BYTES) {
        rejectedSize += 1;
        continue;
      }
      accepted.push(file);
    }

    const toAdd = accepted.slice(0, remainingSlots);
    const rejectedForCapacity = accepted.length - toAdd.length;
    const hasAnyRejection = rejectedType > 0 || rejectedSize > 0 || rejectedForCapacity > 0;

    if (hasAnyRejection) {
      const parts: string[] = [];
      if (toAdd.length > 0)
        parts.push(`${toAdd.length} of ${incoming.length} selected files were added`);
      if (rejectedType > 0) {
        parts.push(
          allowPdf
            ? `${rejectedType} unsupported file${rejectedType === 1 ? "" : "s"} rejected (PDF, JPG, PNG or WebP only)`
            : `${rejectedType} unsupported file${rejectedType === 1 ? "" : "s"} rejected (JPG, PNG or WebP only)`,
        );
      }
      if (rejectedSize > 0)
        parts.push(`${rejectedSize} file${rejectedSize === 1 ? "" : "s"} over 8 MB rejected`);
      if (rejectedForCapacity > 0) {
        parts.push(`${rejectedForCapacity} exceeded the ${maxFiles}-${singularNoun} limit`);
      }
      setError(`${parts.join("; ")}.`);
    } else if (toAdd.length > 0) {
      // Fix 1: the latest selection/drop was fully valid — clear any stale error from a prior attempt.
      setError(undefined);
    }

    if (toAdd.length > 0) {
      onChange([...files, ...toAdd.map(createLocalFile)]);
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  function removeFile(id: string) {
    const target = files.find((f) => f.id === id);
    if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
    onChange(files.filter((f) => f.id !== id));
    // A capacity/rejection error can go stale the moment a slot frees up.
    setError(undefined);
  }

  const hasFiles = files.length > 0;
  const atCapacity = files.length >= maxFiles;

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-foreground/50">
          {files.length} of {maxFiles} {countLabel}
        </span>
      </div>

      {!atCapacity && (
        <label
          htmlFor={inputId}
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            handleFiles(e.dataTransfer.files);
          }}
          className={`mt-2 flex w-full cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed text-center transition-colors ${
            dragActive
              ? "border-copper bg-[oklch(0.583_0.135_45.5/0.06)]"
              : "border-white/20 hover:border-copper/50"
          } ${hasFiles ? "px-4 py-4" : "px-6 py-8"}`}
        >
          {hasFiles ? (
            <span className="flex items-center gap-2 text-xs font-semibold text-foreground/70">
              <Plus aria-hidden="true" className="h-3.5 w-3.5" />
              Add more
            </span>
          ) : (
            <>
              <UploadCloud aria-hidden="true" className="h-6 w-6 text-foreground/50" />
              <span className="font-display text-sm font-bold text-foreground">{title}</span>
              <span className="text-xs text-foreground/60">{browseLabel}</span>
              <span className="text-[0.7rem] text-foreground/40">{acceptLine}</span>
            </>
          )}
        </label>
      )}

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={acceptedTypes.join(",")}
        multiple
        capture="environment"
        aria-label={title}
        className="sr-only"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {error && (
        <p role="alert" className="mt-2 text-[0.8rem] font-medium text-destructive">
          {error}
        </p>
      )}

      {files.length > 0 && (
        <ul className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4">
          {files.map((f) => (
            <li
              key={f.id}
              className="relative aspect-square overflow-hidden rounded-xl border border-white/12 bg-white/5"
            >
              {f.previewUrl ? (
                <img
                  src={f.previewUrl}
                  alt={`Preview of ${f.name}`}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-1 text-center">
                  <Paperclip aria-hidden="true" className="h-4 w-4 text-foreground/50" />
                  <span className="line-clamp-2 text-[0.6rem] text-foreground/60" title={f.name}>
                    {f.name}
                  </span>
                </div>
              )}
              <button
                type="button"
                onClick={() => removeFile(f.id)}
                aria-label={`Remove ${f.name}`}
                className="absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-[#080A1D]/85 text-foreground/90 transition-colors hover:bg-[#080A1D] focus-visible:outline focus-visible:outline-2 focus-visible:outline-copper"
              >
                <X aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
