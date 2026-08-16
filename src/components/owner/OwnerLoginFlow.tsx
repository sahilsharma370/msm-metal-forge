import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { createOwnerLoginTransport, type OwnerLoginTransport } from "./owner-login-transport";
import { createOwnerAuthClient, type OwnerAuthClient } from "./owner-auth-client";

/**
 * CHECKPOINT C2I-A — the owner passwordless (six-digit email OTP) login
 * flow. Two steps only: request a code, then verify it. Every user-facing
 * outcome of requesting a code is the exact same generic copy (see
 * owner-login-transport.ts / owner-login.server.ts) — this component never
 * branches its own UI on whether the email turned out to be
 * registered/authorized, so there is nothing here that could leak that
 * distinction either.
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

export function OwnerLoginFlow({ transport, authClient, onAuthenticated }: OwnerLoginFlowProps) {
  const [ownerTransport] = useState<OwnerLoginTransport>(() => transport ?? createOwnerLoginTransport());
  const [ownerAuthClient] = useState<OwnerAuthClient>(() => authClient ?? createOwnerAuthClient());

  const [step, setStep] = useState<Step>("request");
  const [status, setStatus] = useState<Status>("idle");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const emailFieldId = useId();
  const statusRegionId = useId();

  const busy = status === "submitting";

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
    if (busy) return;
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
  }

  function handleUseDifferentEmail() {
    setStep("request");
    setCode("");
    setErrorMessage(null);
    setInfoMessage(null);
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
            />
          </div>
          <Button type="submit" className="mt-4 w-full" disabled={busy || email.trim().length === 0} aria-busy={busy}>
            {busy ? "Sending…" : "Send sign-in code"}
          </Button>
        </form>
      )}

      {step === "verify" && (
        <form onSubmit={submitVerifyCode} noValidate aria-label="Enter your sign-in code">
          {infoMessage && (
            <p className="mb-4 text-sm text-muted-foreground" aria-hidden="true">
              {infoMessage}
            </p>
          )}
          <fieldset disabled={busy}>
            <legend className="text-sm font-medium leading-none">6-digit code</legend>
            <div className="mt-2">
              <InputOTP
                maxLength={6}
                value={code}
                onChange={(value) => setCode(value.replace(/[^0-9]/g, ""))}
                aria-label="6-digit sign-in code"
                inputMode="numeric"
              >
                <InputOTPGroup>
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                  <InputOTPSlot index={3} />
                  <InputOTPSlot index={4} />
                  <InputOTPSlot index={5} />
                </InputOTPGroup>
              </InputOTP>
            </div>
          </fieldset>
          <Button type="submit" className="mt-4 w-full" disabled={busy || code.length !== 6} aria-busy={busy}>
            {busy ? "Verifying…" : "Verify code"}
          </Button>
          <div className="mt-3 flex items-center justify-between text-sm">
            <button
              type="button"
              className="text-muted-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onClick={handleResend}
              disabled={busy}
            >
              Resend code
            </button>
            <button
              type="button"
              className="text-muted-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onClick={handleUseDifferentEmail}
              disabled={busy}
            >
              Use a different email
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
