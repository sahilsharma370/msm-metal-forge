/**
 * CHECKPOINT C2I-A — tiny bounded-body reader shared by the owner login
 * routes. Deliberately not the Quote pipeline's own readBoundedBody
 * (initiate-quote.ts): that one streams/counts bytes incrementally because
 * a Quote request body can legitimately approach tens of KB; an owner
 * login body is always exactly an email and/or a 6-digit code, so a flat
 * content-length + post-read length check is simpler and sufficient here
 * — reusing the Quote pipeline's version would couple two unrelated
 * feature areas for no real benefit. `.server.ts` suffix — see
 * env.server.ts for why that's sufficient import protection on its own.
 */

/** Generous for an email + 6-digit code JSON body; still small enough to make an oversized-body flood cheap to reject. */
export const MAX_OWNER_LOGIN_BODY_BYTES = 4 * 1024;

export class OwnerLoginBodyTooLargeError extends Error {
  constructor() {
    super("Request body is too large.");
    this.name = "OwnerLoginBodyTooLargeError";
  }
}

export async function readOwnerLoginBody(request: Request): Promise<string> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > MAX_OWNER_LOGIN_BODY_BYTES) {
    throw new OwnerLoginBodyTooLargeError();
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_OWNER_LOGIN_BODY_BYTES) {
    throw new OwnerLoginBodyTooLargeError();
  }
  return text;
}
