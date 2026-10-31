import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { createOwnerLoginTransport, type OwnerLoginTransport } from "./owner-login-transport";
import { createOwnerAuthClient, type OwnerAuthClient } from "./owner-auth-client";
import { cn } from "@/lib/utils";

/**
 * CHECKPOINT C2I-A — the owner passwordless (six-digit email OTP) login
 * flow. Two steps only: request a code, then verify it. Every user-facing
 * outcome of requesting a code is the exact same generic copy (see
 * owner-login-transport.ts / owner-login.server.ts) — this component never
 * branches its own UI on whether the email turned out to be
 * registered/authorized, so there is nothing here that could leak that
 * distinction either. Never a password field, never implies one.
 *
 * `transport`/`authClient` are injectable (defaulting to the real
 * fetch/Supabase-backed implementations) purely so tests can exercise this
 * component with fakes — no real network call or Supabase client in tests.
 */
export interface OwnerLoginFlowProps {
  readonly transport?: OwnerLoginTransport;
  readonly authClient?: OwnerAuthClient;
  /** Called once a server-verified session has been adopted via the official setSession() call. */
  readonly onAuthenticated: () => void;
}

type Step = "request" | "verify";
type Status = "idle" | "submitting";

const RATE_LIMITED_MESSAGE = "Too many attempts. Please wait a moment and try again.";

/**
 * Purely a client-side courtesy against accidental double-taps — NOT a
 * security control. The real rate limit is server-side and authoritative
 * (RATE_LIMIT_RETRY_AFTER_SECONDS = 60, RATE_LIMITER_OWNER_LOGIN_REQUEST_CODE
 * = 5/60s — see rate-limit.server.ts / wrangler.jsonc); if this cooldown
 * ever drifts from that, a real over-limit attempt still gets the exact
 * same generic RATE_LIMITED_MESSAGE via the outcome.kind === "rate_limited"
 * branch below, unaffected by this local timer.
 */
const RESEND_COOLDOWN_SECONDS = 30;

const OTP_SLOT_CLASS_NAME = "border-white/15 bg-navy-deep/95";

/** CHECKPOINT OWNER/QUOTE MATTE PASS — the exact copper CTA token used by
 * Continue/Get quote (--gradient-copper-cta, styles.css), reused directly
 * as a design token rather than importing QuoteNavigation's own
 * quotePrimaryCtaSurface helper — this checkpoint's own instruction is not
 * to tightly couple Owner components to the Quote directory, so the token
 * is duplicated here (a few lines), not the component. */
const OWNER_PRIMARY_CTA_ENABLED =
  "bg-[image:var(--gradient-copper-cta)] text-[#080A1D] transition-[color,filter,transform] duration-200 hover:text-[#EDE8D0] hover:[text-shadow:0_1px_2px_rgba(8,10,29,0.65)] hover:brightness-110 focus-visible:text-[#EDE8D0] focus-visible:[text-shadow:0_1px_2px_rgba(8,10,29,0.65)] focus-visible:brightness-110 motion-safe:hover:scale-[1.02] motion-safe:focus-visible:scale-[1.02]";
const OWNER_PRIMARY_CTA_DISABLED = "cursor-not-allowed bg-white/8 text-foreground/35";

function ownerPrimaryCtaSurface(disabled: boolean) {
  return disabled ? OWNER_PRIMARY_CTA_DISABLED : OWNER_PRIMARY_CTA_ENABLED;
}

export function OwnerLoginFlow({ transport, authClient, onAuthenticated }: OwnerLoginFlowProps) {
  const [ownerTransport] = useState<OwnerLoginTransport>(() => transport ?? createOwnerLoginTransport());
  const [ownerAuthClient] = useState<OwnerAuthClient>(() => authClient ?? createOwnerAuthClient());

  const [step, setStep] = useState<Step>("request");
  const [status, setStatus] = useState<Status>("idle");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);

  const emailFieldId = useId();
  const statusRegionId = useId();
  const cooldownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const busy = status === "submitting";

  function startResendCooldown() {
    if (cooldownIntervalRef.current) clearInterval(cooldownIntervalRef.current);
    setResendCooldown(RESEND_COOLDOWN_SECONDS);
    cooldownIntervalRef.current = setInterval(() => {
      setResendCooldown((previous) => {
        if (previous <= 1) {
          if (cooldownIntervalRef.current) clearInterval(cooldownIntervalRef.current);
          return 0;
        }
        return previous - 1;
      });
    }, 1000);
  }

  useEffect(() => {
    return () => {
      if (cooldownIntervalRef.current) clearInterval(cooldownIntervalRef.current);
    };
  }, []);

  async function submitRequestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const trimmedEmail = email.trim();
    if (!trimmedEmail) return;

    setStatus("submitting");
    setErrorMessage(null);
    setInfoMessage(null);

    const outcome = await ownerTransport.requestCode(trimmedEmail);
    setStatus("idle");

    if (outcome.kind === "rate_limited") {
      setErrorMessage(RATE_LIMITED_MESSAGE);
      return;
    }
    if (outcome.kind === "error") {
      setErrorMessage(outcome.message);
      return;
    }

    setInfoMessage(outcome.message);
    setCode("");
    setStep("verify");
    startResendCooldown();
  }

  async function submitVerifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (code.length !== 6) return;

    setStatus("submitting");
    setErrorMessage(null);

    const outcome = await ownerTransport.verifyCode(email.trim(), code);

    if (outcome.kind === "rate_limited") {
      setStatus("idle");
      setErrorMessage(RATE_LIMITED_MESSAGE);
      return;
    }
    if (outcome.kind === "invalid_or_expired") {
      setStatus("idle");
      setErrorMessage(outcome.message);
      setCode("");
      return;
    }
    if (outcome.kind === "error") {
      setStatus("idle");
      setErrorMessage(outcome.message);
      return;
    }

    await ownerAuthClient.setSession(outcome.session);
    setStatus("idle");
    onAuthenticated();
  }

  async function handleResend() {
    if (busy || resendCooldown > 0) return;
    setStatus("submitting");
    setErrorMessage(null);
    setInfoMessage(null);

    const outcome = await ownerTransport.requestCode(email.trim());
    setStatus("idle");

    if (outcome.kind === "rate_limited") {
      setErrorMessage(RATE_LIMITED_MESSAGE);
      return;
    }
    if (outcome.kind === "error") {
      setErrorMessage(outcome.message);
      return;
    }
    setInfoMessage(outcome.message);
    setCode("");
    startResendCooldown();
  }

  function handleUseDifferentEmail() {
    setStep("request");
    setCode("");
    setErrorMessage(null);
    setInfoMessage(null);
    if (cooldownIntervalRef.current) clearInterval(cooldownIntervalRef.current);
    setResendCooldown(0);
  }

  return (
    <div className="mx-auto w-full max-w-sm">
      <div id={statusRegionId} role="status" aria-live="polite" className="sr-only">
        {infoMessage ?? ""}
      </div>
      {errorMessage && (
        <div role="alert" aria-live="assertive" className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {errorMessage}
        </div>
      )}

      {step === "request" && (
        <form onSubmit={submitRequestCode} noValidate aria-label="Request a sign-in code">
          <div className="space-y-2">
            <Label htmlFor={emailFieldId}>Email</Label>
            <Input
              id={emailFieldId}
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              disabled={busy}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="owner@example.com"
              className="h-11 rounded-xl border-white/15 bg-navy-deep/95"
            />
          </div>
          <button
            type="submit"
            disabled={busy || email.trim().length === 0}
            aria-busy={busy}
            className={cn(
              "font-display mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-full px-5 py-3 text-xs font-bold tracking-[0.1em] uppercase",
              ownerPrimaryCtaSurface(busy || email.trim().length === 0),
            )}
          >
            {busy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
            {busy ? "Sending…" : "Send sign-in code"}
          </button>
        </form>
      )}

      {step === "verify" && (
        <form onSubmit={submitVerifyCode} noValidate aria-label="Enter your sign-in code">
          {infoMessage && (
            <p className="mb-4 text-sm text-foreground/70" aria-hidden="true">
              {infoMessage}
            </p>
          )}
          <fieldset disabled={busy}>
            <legend className="text-sm font-medium text-foreground">6-digit code</legend>
            <div className="mt-2">
              <InputOTP
                maxLength={6}
                value={code}
                onChange={(value) => setCode(value.replace(/[^0-9]/g, ""))}
                aria-label="6-digit sign-in code"
                inputMode="numeric"
                autoComplete="one-time-code"
              >
                <InputOTPGroup>
                  <InputOTPSlot index={0} className={OTP_SLOT_CLASS_NAME} />
                  <InputOTPSlot index={1} className={OTP_SLOT_CLASS_NAME} />
                  <InputOTPSlot index={2} className={OTP_SLOT_CLASS_NAME} />
                  <InputOTPSlot index={3} className={OTP_SLOT_CLASS_NAME} />
                  <InputOTPSlot index={4} className={OTP_SLOT_CLASS_NAME} />
                  <InputOTPSlot index={5} className={OTP_SLOT_CLASS_NAME} />
                </InputOTPGroup>
              </InputOTP>
            </div>
          </fieldset>
          <button
            type="submit"
            disabled={busy || code.length !== 6}
            aria-busy={busy}
            className={cn(
              "font-display mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-full px-5 py-3 text-xs font-bold tracking-[0.1em] uppercase",
              ownerPrimaryCtaSurface(busy || code.length !== 6),
            )}
          >
            {busy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
            {busy ? "Verifying…" : "Verify code"}
          </button>
          <div className="mt-3 flex items-center justify-between text-sm">
            <button
              type="button"
              className="text-foreground/70 underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:no-underline"
              onClick={() => void handleResend()}
              disabled={busy || resendCooldown > 0}
            >
              {resendCooldown > 0 ? `Resend code (${resendCooldown}s)` : "Resend code"}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-foreground/70 underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onClick={handleUseDifferentEmail}
              disabled={busy}
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              Use a different email
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
