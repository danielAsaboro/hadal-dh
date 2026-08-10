interface LandingPageProps {
  readonly onEnterWorkspace: () => void;
}

export function LandingPage({ onEnterWorkspace }: LandingPageProps) {
  return (
    <div className="landing-page">
      <header className="landing-nav">
        <a className="brand-lockup" href="#top" aria-label="Hadal home">
          <span className="cut-mark">HD/</span>
          <span>Hadal</span>
        </a>
        <nav aria-label="Landing navigation">
          <a href="#method">How it works</a>
          <a href="#principles">Why it matters</a>
        </nav>
      </header>

      <main id="top" aria-labelledby="landing-title">
        <section className="landing-hero" aria-labelledby="landing-title">
          <p className="eyebrow">Metadata-aware change coordination</p>
          <h1 id="landing-title">Turn graph evidence into coordinated, accountable, validated work.</h1>
          <p>
            DataHub is the canonical institutional memory. Hadal reads that governed context,
            coordinates the work it requires, validates the outcome, and writes durable resolution back.
          </p>
          <a href="/workspace" onClick={(event) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            onEnterWorkspace();
          }}>Enter governed workspace</a>
        </section>

        <section id="method" aria-labelledby="method-title">
          <p className="eyebrow">A governed change lifecycle</p>
          <h2 id="method-title">Evidence becomes accountable work</h2>
          <ol className="landing-stages">
            <li><strong>Graph evidence</strong><span>Read canonical schema, ownership, lineage, queries, and governance context.</span></li>
            <li><strong>Accountable execution</strong><span>Derive bounded owner work from the complete evidence set.</span></li>
            <li><strong>Governed approval</strong><span>Hold mutations and merge authority behind explicit, auditable decisions.</span></li>
            <li><strong>Durable resolution</strong><span>Validate the exact Git revision and persist the verified outcome to DataHub.</span></li>
          </ol>
        </section>

        <section className="landing-preview" aria-label="Command center vocabulary">
          <p className="eyebrow">Command center</p>
          <h2>One decision record, grounded in canonical context</h2>
          <div>
            <span>DataHub evidence</span>
            <span>Owner work</span>
            <span>Approval gate</span>
            <span>Validation receipts</span>
            <span>Resolution history</span>
          </div>
        </section>

        <section id="principles" className="landing-principles" aria-label="Product principles">
          <article>
            <p className="eyebrow">Canonical evidence</p>
            <h2>See the governed consequence</h2>
            <p>Read multi-hop impact and governance context before work begins. Missing context blocks the path.</p>
          </article>
          <article>
            <p className="eyebrow">Named accountability</p>
            <h2>Coordinate real execution</h2>
            <p>Translate graph evidence into owner work, bounded agent actions, and explicit human approvals.</p>
          </article>
          <article>
            <p className="eyebrow">Institutional memory</p>
            <h2>Preserve the resolution</h2>
            <p>Bind validation to the immutable Git revision and return the durable decision record to DataHub.</p>
          </article>
        </section>
      </main>
    </div>
  );
}
