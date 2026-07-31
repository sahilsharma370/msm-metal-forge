export function ScaleIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 96"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M60 10v66" />
      <path d="M28 24h64" />
      <circle cx="60" cy="10" r="3" />
      <path d="M40 78h40" />
      <path d="M28 24 14 54h28L28 24Z" />
      <path d="M92 24 78 54h28L92 24Z" />
      <path d="M14 54a14 14 0 0 0 28 0" />
      <path d="M78 54a14 14 0 0 0 28 0" />
    </svg>
  );
}