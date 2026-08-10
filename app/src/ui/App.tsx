import { useEffect, useState } from "react";

import { LandingPage } from "./LandingPage";
import { Button } from "./components/ui/Button";
import { Icons } from "./icons";
import { parseAppRoute, type AppRoute } from "./routes";
import { SignInPage } from "./SignInPage";
import { httpSessionClient, type SessionClient, type SessionState } from "./session-client";
import { Workspace, httpWorkspaceClient, type WorkspaceClient } from "./Workspace";

export { httpWorkspaceClient, type WorkspaceClient } from "./Workspace";

interface AppProps {
  readonly client?: WorkspaceClient;
  readonly sessionClient?: SessionClient;
  readonly initialPath?: string;
}

function routeAt(pathname: string): Exclude<AppRoute, { kind: "case-redirect" }> {
  const route = parseAppRoute(pathname);
  if (route.kind !== "case-redirect") return route;
  window.history.replaceState(window.history.state, "", `${route.destination}${window.location.search}${window.location.hash}`);
  return { kind: "case", caseKey: route.caseKey, page: "overview" };
}

function NotFound({ workspace }: { readonly workspace: boolean }) {
  return (
    <main className="center-state" aria-labelledby="not-found-title">
      <h1 id="not-found-title">{workspace ? "Workspace page not found" : "Public page not found"}</h1>
      <p>{workspace ? "This governed workspace route is not available." : "This public route is not available."}</p>
    </main>
  );
}

function WorkspaceGate({ client, sessionClient, route, onNavigate }: {
  readonly client: WorkspaceClient;
  readonly sessionClient: SessionClient;
  readonly route: Exclude<AppRoute, { kind: "landing" | "public-not-found" | "case-redirect" }>;
  readonly onNavigate: (destination: string) => void;
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
          <Button variant="secondary" onClick={() => setReadKey((value) => value + 1)}><Icons.refresh aria-hidden="true" size={16} /> Retry session check</Button>
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
  if (route.kind === "workspace-not-found") return <NotFound workspace />;
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
        route={route}
        onNavigate={onNavigate}
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
  const [route, setRoute] = useState(() => routeAt(initialPath ?? window.location.pathname));

  useEffect(() => {
    const onPopState = () => setRoute(routeAt(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route]);

  const navigate = (destination: string) => {
    window.history.pushState({}, "", destination);
    setRoute(routeAt(destination));
  };

  if (route.kind === "landing") return <LandingPage onEnterWorkspace={() => navigate("/workspace")} />;
  if (route.kind === "public-not-found") return <NotFound workspace={false} />;
  return <WorkspaceGate client={client} sessionClient={sessionClient} route={route} onNavigate={navigate} />;
}
