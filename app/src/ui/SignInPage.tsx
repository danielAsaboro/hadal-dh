import { useState, type FormEvent } from "react";

interface SignInPageProps {
  readonly onSignIn: (passphrase: string) => Promise<void>;
}

export function SignInPage({ onSignIn }: SignInPageProps) {
  const [passphrase, setPassphrase] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    try {
      await onSignIn(passphrase);
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : "Credentials were not accepted";
      setError(`Sign-in failed. ${detail}`);
      setPassphrase("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="sign-in-page">
      <section aria-labelledby="sign-in-title">
        <div className="brand-lockup"><span className="cut-mark">CM/</span><span>ChangeMarshal</span></div>
        <p className="eyebrow">Governed operator access</p>
        <h1 id="sign-in-title">Operator sign-in</h1>
        <p>Enter the passphrase configured by this ChangeMarshal deployment to access real governed cases.</p>
        {error && <p className="error-banner" role="alert">{error}</p>}
        <form onSubmit={(event) => void submit(event)}>
          <label htmlFor="operator-passphrase">Operator passphrase</label>
          <input
            id="operator-passphrase"
            type="password"
            autoComplete="current-password"
            required
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
          />
          <button type="submit" disabled={submitting || passphrase.length === 0}>
            {submitting ? "Verifying session…" : "Sign in to workspace"}
          </button>
        </form>
        <p>Your passphrase is submitted only to this deployment and is not stored in browser storage.</p>
      </section>
    </main>
  );
}
