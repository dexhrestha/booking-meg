import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";

const totpPeriodSeconds = 30;
const totpDigits = 6;
const sessionDurationSeconds = 8 * 60 * 60;

type AdminAuthResult = {
  authorized: boolean;
  method?: "api-token" | "session-token" | "totp";
};

function getAdminTotpSecret() {
  return (
    process.env.BOOKING_ADMIN_2FA_SECRET ??
    process.env.ADMIN_2FA_SECRET ??
    ""
  ).trim();
}

function getAdminApiTokens(extraTokens: string[] = []) {
  const envTokens = [
    process.env.BOOKING_ADMIN_API_TOKEN,
    process.env.BOOKING_ADMIN_API_TOKENS,
    process.env.ADMIN_API_TOKEN,
    process.env.ADMIN_API_TOKENS,
  ];

  return [...envTokens, ...extraTokens]
    .flatMap((value) => value?.split(",") ?? [])
    .map((value) => value.trim())
    .filter(Boolean);
}

function getRequestPin(request: NextRequest) {
  return (
    request.headers.get("x-admin-pin") ??
    request.headers.get("x-admin-otp") ??
    request.nextUrl.searchParams.get("pin") ??
    request.nextUrl.searchParams.get("otp") ??
    ""
  );
}

function getRequestApiToken(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  const bearerToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();

  return (
    request.headers.get("x-admin-api-token") ??
    bearerToken ??
    request.nextUrl.searchParams.get("token") ??
    ""
  );
}

function getRequestSessionToken(request: NextRequest) {
  return request.headers.get("x-admin-session-token") ?? "";
}

function safeEquals(first: string, second: string) {
  const firstBuffer = Buffer.from(first);
  const secondBuffer = Buffer.from(second);

  return (
    firstBuffer.length === secondBuffer.length &&
    timingSafeEqual(firstBuffer, secondBuffer)
  );
}

function decodeBase32Secret(secret: string) {
  const normalized = secret
    .replaceAll(/\s|-/g, "")
    .replace(/=+$/g, "")
    .toUpperCase();

  if (!normalized || /[^A-Z2-7]/.test(normalized)) {
    return Buffer.from(secret, "utf8");
  }

  let bits = "";

  for (const character of normalized) {
    const value = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(character);
    bits += value.toString(2).padStart(5, "0");
  }

  const bytes: number[] = [];

  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }

  return Buffer.from(bytes);
}

function generateTotp(secret: string, counter: number) {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const hmac = createHmac("sha1", decodeBase32Secret(secret))
    .update(counterBuffer)
    .digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(binary % 10 ** totpDigits).padStart(totpDigits, "0");
}

function isValidTotp(secret: string, pin: string) {
  const normalizedPin = pin.replaceAll(/\s/g, "");

  if (!/^\d{6}$/.test(normalizedPin)) {
    return false;
  }

  const currentCounter = Math.floor(Date.now() / 1000 / totpPeriodSeconds);

  return [-1, 0, 1].some((windowOffset) =>
    safeEquals(
      generateTotp(secret, currentCounter + windowOffset),
      normalizedPin,
    ),
  );
}

function isValidAdminTotpRequest(request: NextRequest) {
  const totpSecret = getAdminTotpSecret();

  return totpSecret !== "" && isValidTotp(totpSecret, getRequestPin(request));
}

function isValidAdminApiToken(request: NextRequest, extraTokens: string[] = []) {
  const requestToken = getRequestApiToken(request);

  if (requestToken === "") {
    return false;
  }

  return getAdminApiTokens(extraTokens).some((token) =>
    safeEquals(requestToken, token),
  );
}

function getSessionSigningSecret() {
  return getAdminTotpSecret();
}

function signSessionPayload(payload: string) {
  return createHmac("sha256", getSessionSigningSecret())
    .update(payload)
    .digest("base64url");
}

function isValidAdminSessionToken(request: NextRequest) {
  const signingSecret = getSessionSigningSecret();
  const token = getRequestSessionToken(request);
  const [payload, signature] = token.split(".");

  if (!signingSecret || !payload || !signature) {
    return false;
  }

  if (!safeEquals(signSessionPayload(payload), signature)) {
    return false;
  }

  try {
    const session = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { exp?: unknown };

    return (
      typeof session.exp === "number" &&
      Number.isFinite(session.exp) &&
      session.exp > Math.floor(Date.now() / 1000)
    );
  } catch {
    return false;
  }
}

export function authorizeAdminRequest(
  request: NextRequest,
  extraApiTokens: string[] = [],
): AdminAuthResult {
  if (isValidAdminApiToken(request, extraApiTokens)) {
    return { authorized: true, method: "api-token" };
  }

  if (isValidAdminSessionToken(request)) {
    return { authorized: true, method: "session-token" };
  }

  if (isValidAdminTotpRequest(request)) {
    return { authorized: true, method: "totp" };
  }

  return { authorized: false };
}

export function isAdminRequestAuthorized(request: NextRequest) {
  return authorizeAdminRequest(request).authorized;
}

export function createAdminSessionToken() {
  const signingSecret = getSessionSigningSecret();

  if (!signingSecret) {
    return "";
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      iat: now,
      exp: now + sessionDurationSeconds,
    }),
  ).toString("base64url");

  return `${payload}.${signSessionPayload(payload)}`;
}

export function unauthorizedAdminResponse() {
  return NextResponse.json(
    { message: "Enter a valid 6-digit PIN or admin API token." },
    { status: 401 },
  );
}
