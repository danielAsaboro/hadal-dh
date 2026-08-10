import { createHmac, timingSafeEqual } from "node:crypto";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

export const SESSION_COOKIE_NAME = "changemarshal_session";

export type UiSessionConfig = Readonly<{
  passphrase: string;
  signingSecret: string;
  ttlSeconds: number;
  secureCookie: boolean;
}>;

const sessionBody = z.object({ passphrase: z.string().min(1).max(1_024) }).strict();
const tokenPattern = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/;

function digest(value: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(value).digest();
}

function hasMatchingPassphrase(passphrase: string, config: UiSessionConfig): boolean {
  return timingSafeEqual(digest(passphrase, config.signingSecret), digest(config.passphrase, config.signingSecret));
}

function issueToken(config: UiSessionConfig, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(now / 1_000) + config.ttlSeconds })).toString("base64url");
  return `${payload}.${digest(payload, config.signingSecret).toString("base64url")}`;
}

function sessionCookie(token: string, maxAge: number, secure: boolean): string {
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly;${secure ? " Secure;" : ""} SameSite=Strict; Max-Age=${maxAge}`;
}

function cookieValue(request: FastifyRequest): string | undefined {
  const header = request.headers.cookie;
  if (header === undefined) return undefined;
  const matches = header.split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (matches.length !== 1) return undefined;
  return matches[0]!.slice(SESSION_COOKIE_NAME.length + 1);
}

function isValidToken(value: string | undefined, config: UiSessionConfig, now = Date.now()): boolean {
  if (value === undefined) return false;
  const match = tokenPattern.exec(value);
  if (match === null) return false;
  const payload = match[1]!;
  const signature = match[2]!;
  const expected = digest(payload, config.signingSecret);
  const received = Buffer.from(signature, "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)
      || Object.keys(parsed).length !== 1 || typeof parsed.exp !== "number" || !Number.isSafeInteger(parsed.exp)) return false;
    return parsed.exp > Math.floor(now / 1_000);
  } catch {
    return false;
  }
}

function authenticated(request: FastifyRequest, config: UiSessionConfig | undefined): boolean {
  return config === undefined || isValidToken(cookieValue(request), config);
}

export async function requireSession(request: FastifyRequest, reply: FastifyReply, config: UiSessionConfig): Promise<boolean> {
  if (authenticated(request, config)) return true;
  await reply.status(401).send({ error: "unauthorized" });
  return false;
}

export function registerSessionRoutes(server: FastifyInstance, config: UiSessionConfig | undefined): void {
  server.get("/api/session", async (request) => ({ configured: config !== undefined, authenticated: authenticated(request, config) }));
  server.post("/api/session", async (request, reply) => {
    if (config === undefined) return await reply.status(404).send({ error: "session_not_configured" });
    const { passphrase } = sessionBody.parse(request.body);
    if (!hasMatchingPassphrase(passphrase, config)) return await reply.status(401).send({ error: "unauthorized" });
    return await reply.header("Set-Cookie", sessionCookie(issueToken(config), config.ttlSeconds, config.secureCookie)).status(204).send();
  });
  server.delete("/api/session", async (_request, reply) =>
    await reply.header("Set-Cookie", sessionCookie("", 0, config?.secureCookie ?? true)).status(204).send());
}
