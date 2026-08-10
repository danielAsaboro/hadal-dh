import { useState, type ReactNode } from "react";

import type { AgentRunEvent } from "../ai/run-events";
import { Button } from "./components/ui/Button";
import { Icons } from "./icons";

const eventPageSize = 25;

export function BoundedAgentEvents({ events, label, className, renderEvent }: Readonly<{
  events: readonly AgentRunEvent[];
  label: string;
  className: string;
  renderEvent: (event: AgentRunEvent) => ReactNode;
}>) {
  const [requestedPage, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(events.length / eventPageSize));
  const page = Math.min(requestedPage, pageCount);
  const rows = events.slice((page - 1) * eventPageSize, page * eventPageSize);
  return (
    <>
      <ol className={className} aria-label={label}>{rows.map(renderEvent)}</ol>
      {pageCount > 1 && (
        <div className="pagination-bar case-pagination agent-event-pagination">
          <Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}><Icons.arrowLeft aria-hidden="true" size={15} /> Previous</Button>
          <span role="status" aria-label={`${label} pagination`}>Page {page} of {pageCount} · {events.length} events</span>
          <Button variant="secondary" size="sm" disabled={page === pageCount} onClick={() => setPage(page + 1)}>Next <Icons.arrowRight aria-hidden="true" size={15} /></Button>
        </div>
      )}
    </>
  );
}
