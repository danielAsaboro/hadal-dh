export type SessionState = Readonly<{
  configured: boolean;
  authenticated: boolean;
}>;

export interface SessionClient {
  read(): Promise<SessionState>;
  signIn(passphrase: string): Promise<void>;
  signOut(): Promise<void>;
}

function sessionState(value: unknown): SessionState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Session endpoint returned an invalid response");
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.configured !== "boolean" || typeof candidate.authenticated !== "boolean") {
    throw new Error("Session endpoint returned an invalid response");
  }
  if (!candidate.configured && !candidate.authenticated) {
    throw new Error("Session endpoint returned an unauthenticated local state");
  }
  return { configured: candidate.configured, authenticated: candidate.authenticated };
}

async function failure(response: Response): Promise<Error> {
  try {
    const value = await response.json() as unknown;
    if (typeof value === "object" && value !== null && "error" in value) {
      const code = String((value as { error: unknown }).error);
      if (code === "unauthorized") return new Error("Unauthorized");
      return new Error(code.replaceAll("_", " "));
    }
  } catch {
    // Fall through to the status-based error when the response is not JSON.
  }
  return new Error(`Session request failed with HTTP ${response.status}`);
}

async function expectSuccess(response: Response): Promise<void> {
  if (!response.ok) throw await failure(response);
}

export const httpSessionClient: SessionClient = {
  read: async () => {
    const response = await fetch("/api/session", { credentials: "same-origin", headers: { Accept: "application/json" } });
    await expectSuccess(response);
    return sessionState(await response.json() as unknown);
  },
  signIn: async (passphrase) => {
    const response = await fetch("/api/session", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase }),
    });
    await expectSuccess(response);
  },
  signOut: async () => {
    const response = await fetch("/api/session", { method: "DELETE", credentials: "same-origin" });
    await expectSuccess(response);
  },
};
