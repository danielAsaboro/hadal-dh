import { useEffect, useState } from "react";

import { LandingPage } from "./LandingPage";
import { SignInPage } from "./SignInPage";
import { httpSessionClient, type SessionClient, type SessionState } from "./session-client";
import { Workspace, httpWorkspaceClient, type WorkspaceClient } from "./Workspace";

export { httpWorkspaceClient, type WorkspaceClient } from "./Workspace";

type AppPath = "/" | "/workspace";

interface AppProps {
  readonly client?: WorkspaceClient;
  readonly sessionClient?: SessionClient;
  readonly initialPath?: string;
}

function appPath(pathname: string): AppPath {
  return pathname === "/workspace" ? "/workspace" : "/";
}

function WorkspaceGate({ client, sessionClient }: {
  readonly client: WorkspaceClient;
  readonly sessionClient: SessionClient;
}) {
  const [session, setSession] = useState<SessionState>();
  const [error, setError] = useState<string>();
  const [readKey, setReadKey] = useState(0);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [signOutError, setSignOutError] = useState<string>();

  useEffect(() => {
    let active = true;
    setSession(undefined);
    setError(undefined);
    void sessionClient.read().then((value) => {
      if (active) setSession(value);
    }).catch((caught: unknown) => {
      if (!active) return;
      setError(caught instanceof Error ? caught.message : "Could not verify the operator session");
    });
    return () => { active = false; };
  }, [readKey, sessionClient]);

  if (error !== undefined) {
    return (
      <main className="center-state">
        <div role="alert">
          <p>Session verification failed. {error}</p>
          <button onClick={() => setReadKey((value) => value + 1)}>Retry session check</button>
        </div>
      </main>
    );
  }
  if (session === undefined) return <main className="center-state" role="status">Verifying operator session…</main>;
  if (session.configured && !session.authenticated) {
    return <SignInPage
      onSignIn={async (passphrase) => {
        await sessionClient.signIn(passphrase);
        const verified = await sessionClient.read();
        if (!verified.authenticated) throw new Error("The session could not be verified");
        setSession(verified);
      }}
    />;
  }
  if (!session.authenticated) {
    return <main className="center-state"><p role="alert">Session verification failed. Unauthenticated local access was rejected.</p></main>;
  }
  const signOut = async () => {
    setSignOutBusy(true);
    setSignOutError(undefined);
    try {
      await sessionClient.signOut();
      setSession({ configured: true, authenticated: false });
    } catch (caught) {
      setSignOutError(caught instanceof Error ? caught.message : "Could not end the operator session");
    } finally {
      setSignOutBusy(false);
    }
  };
  return (
    <>
      {!session.configured && <p className="local-session-label" role="status">Local operator session · authentication not configured</p>}
      <Workspace
        client={client}
        {...(session.configured ? {
          sessionAction: {
            busy: signOutBusy,
            ...(signOutError === undefined ? {} : { error: signOutError }),
            onSignOut: () => void signOut(),
          },
        } : {})}
      />
    </>
  );
}

export function App({
  client = httpWorkspaceClient,
  sessionClient = httpSessionClient,
  initialPath,
}: AppProps) {
  const [path, setPath] = useState<AppPath>(() => appPath(initialPath ?? window.location.pathname));

  useEffect(() => {
    const onPopState = () => setPath(appPath(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = (destination: AppPath) => {
    window.history.pushState({}, "", destination);
    setPath(destination);
  };

  if (path === "/") return <LandingPage onEnterWorkspace={() => navigate("/workspace")} />;
  return <WorkspaceGate client={client} sessionClient={sessionClient} />;
}
