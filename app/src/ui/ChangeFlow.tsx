import { useMemo, useState } from "react";
import { Background, Controls, MiniMap, ReactFlow, type NodeMouseHandler } from "@xyflow/react";

import type { AgentRunSnapshot } from "../ai/run-events";
import type { ChangeCase } from "../domain/case";
import { FlowNode } from "./FlowNode";
import { projectCaseFlow, type ChangeNode } from "./flow-model";

const nodeTypes = { changeStage: FlowNode };

export function ChangeFlow({ value, run }: Readonly<{ value: ChangeCase; run?: AgentRunSnapshot }>) {
  const flow = useMemo(() => projectCaseFlow(value, run), [value, run]);
  const [selectedId, setSelectedId] = useState("decision");
  const selected = flow.nodes.find((node) => node.id === selectedId) ?? flow.nodes[0]!;
  const selectNode: NodeMouseHandler<ChangeNode> = (_event, node) => setSelectedId(node.id);

  return (
    <section className="flow-command-center" aria-label="Governed execution graph">
      <div className="flow-heading">
        <div><p className="eyebrow">Live coordination map</p><h2>Governed execution graph</h2></div>
        <div className="flow-runtime"><span className={run === undefined ? "runtime-dot idle" : "runtime-dot"} />{run === undefined ? "QVAC agent ready when configured" : `${run.modelId} · ${run.status.replaceAll("_", " ")}`}</div>
      </div>
      <div className="flow-grid">
        <div className="flow-canvas">
          <ReactFlow<ChangeNode>
            nodes={flow.nodes}
            edges={flow.edges}
            nodeTypes={nodeTypes}
            onNodeClick={selectNode}
            fitView
            fitViewOptions={{ padding: 0.16 }}
            minZoom={0.32}
            maxZoom={1.35}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            nodesFocusable
            edgesFocusable
            panOnDrag
            zoomOnScroll
            ariaLabelConfig={{ "controls.ariaLabel": "Graph controls", "minimap.ariaLabel": "Execution graph mini map" }}
            proOptions={{ hideAttribution: false }}
          >
            <Background color="#293140" gap={24} size={1} />
            <MiniMap pannable zoomable nodeColor={(node) => node.data?.status === "blocked" ? "#f4776c" : node.data?.status === "verified" ? "#6ee7a7" : "#778399"} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
        <aside className="flow-inspector" aria-label="Selected execution evidence">
          <p className="eyebrow">Selected stage</p>
          <div className="inspector-title"><h3>{selected.data.label}</h3><span className={`flow-state flow-state-${selected.data.status}`}>{selected.data.status}</span></div>
          <p>{selected.data.detail}</p>
          <dl>
            <div><dt>Case</dt><dd>{value.caseKey.slice(0, 12)}</dd></div>
            <div><dt>Git head</dt><dd>{value.revision.headSha.slice(0, 12)}</dd></div>
            <div><dt>DataHub</dt><dd>{value.dataHub.verified ? "Reread verified" : "Verification pending"}</dd></div>
          </dl>
          {selected.id === "decision" && <div className="authority-note"><strong>Deterministic policy alone controls admission.</strong><span>The local model may coordinate tools; it cannot choose or override this verdict.</span></div>}
          {selected.id === "datahub" && <div className="inspector-paths"><strong>Exact graph evidence</strong><span>{value.evidence.assets.length} assets · {value.evidence.paths.length} paths · {new Set(value.workItems.map((work) => work.ownerUrn)).size} owners</span></div>}
        </aside>
      </div>
    </section>
  );
}
