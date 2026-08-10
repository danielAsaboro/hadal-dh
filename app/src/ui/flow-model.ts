import dagre from "@dagrejs/dagre";
import { MarkerType, Position, type Edge, type Node } from "@xyflow/react";

import type { AgentRunSnapshot } from "../ai/run-events";
import type { ChangeCase } from "../domain/case";
import { statusPresentation, type OperationalStatus } from "./StatusIndicator";

export type ChangeStageStatus = OperationalStatus;

type ChangeNodeBaseData = Readonly<{
  label: string;
  eyebrow: string;
  status: ChangeStageStatus;
  detail: string;
}>;

export type ChangeNodeData = Record<string, unknown> & ChangeNodeBaseData & Readonly<{
  statusLabel: string;
  statusIcon: string;
}>;

export type ChangeNode = Node<ChangeNodeData, "changeStage">;
export type ChangeEdge = Edge<{ status: ChangeStageStatus }, "smoothstep">;

const width = 210;
const height = 108;

function everyWork(value: ChangeCase, predicate: (workKey: string) => boolean): boolean {
  return value.workItems.length > 0 && value.workItems.every((work) => predicate(work.workKey));
}

function stageNodes(value: ChangeCase, run?: AgentRunSnapshot): ChangeNode[] {
  const projectionKeys = new Set(value.externalProjections.filter((item) => item.state === "verified").map((item) => item.workKey));
  const validReceiptKeys = new Set(value.validationReceipts.filter((item) => item.valid && item.headSha === value.revision.headSha).map((item) => item.workKey));
  const approvedRequirements = new Set(value.approvalDecisions.filter((item) => item.verdict === "approve" && item.headSha === value.revision.headSha).map((item) => item.requirementKey));
  const workVerified = everyWork(value, (key) => projectionKeys.has(key));
  const validationVerified = everyWork(value, (key) => validReceiptKeys.has(key));
  const approvalsVerified = value.approvalRequirements.length > 0
    && value.approvalRequirements.every((item) => approvedRequirements.has(item.requirementKey));
  const runningTool = run?.events.findLast((event) => event.kind === "tool_started")?.toolName;
  const runFailed = run?.status === "failed";
  const statusFor = (tool: string, fallback: ChangeStageStatus): ChangeStageStatus => {
    if (runFailed) return "failed";
    return runningTool === tool ? "active" : fallback;
  };
  const values: Array<Readonly<{ id: string; data: ChangeNodeBaseData }>> = [
    { id: "git", data: { eyebrow: "Immutable scope", label: "Git change", status: "verified", detail: value.revision.headSha.slice(0, 10) } },
    { id: "datahub", data: { eyebrow: "Graph evidence", label: "DataHub impact", status: value.dataHub.verified ? "verified" : "waiting", detail: `${value.evidence.paths.length} lineage path${value.evidence.paths.length === 1 ? "" : "s"}` } },
    { id: "case", data: { eyebrow: "Canonical record", label: "Change case", status: value.evidence.complete ? "verified" : "blocked", detail: value.caseKey.slice(0, 8) } },
    { id: "work", data: { eyebrow: "External execution", label: "Owner work", status: statusFor("syncGitHubWork", workVerified ? "verified" : "waiting"), detail: `${projectionKeys.size}/${value.workItems.length} verified` } },
    { id: "approvals", data: { eyebrow: "SHA-bound", label: "Approvals", status: statusFor("reconcileGitHubWork", approvalsVerified ? "verified" : "waiting"), detail: `${approvedRequirements.size}/${value.approvalRequirements.length} approved` } },
    { id: "remediation", data: { eyebrow: "Graph-grounded", label: "Remediation", status: statusFor("generateRemediation", validationVerified ? "verified" : "waiting"), detail: validationVerified ? "Artifacts verified" : "Artifacts pending" } },
    { id: "validation", data: { eyebrow: "Deterministic", label: "Validation", status: statusFor("validateWork", validationVerified ? "verified" : "waiting"), detail: `${validReceiptKeys.size}/${value.workItems.length} receipts` } },
    { id: "decision", data: { eyebrow: "Policy authority", label: "Merge decision", status: statusFor("publishMergeDecision", value.admission === undefined ? "waiting" : value.admission.allowed ? "verified" : "blocked"), detail: value.admission?.allowed ? "Allowed" : `${value.admission?.blockers.length ?? 1} blocker${value.admission?.blockers.length === 1 ? "" : "s"}` } },
    { id: "resolution", data: { eyebrow: "Institutional memory", label: "DataHub resolution", status: value.dataHub.verified && value.admission !== undefined ? "verified" : "waiting", detail: value.dataHub.verified ? "Reread verified" : "Write-back pending" } },
  ];
  return values.map(({ id, data }) => {
    const presentedData: ChangeNodeData = { ...data, ...statusPresentation(data.status) };
    return {
      id,
      type: "changeStage" as const,
      data: presentedData,
      position: { x: 0, y: 0 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      draggable: true,
      connectable: false,
      selectable: true,
      focusable: true,
      ariaLabel: `${presentedData.label}: ${presentedData.statusIcon} ${presentedData.statusLabel}. ${presentedData.detail}`,
    };
  });
}

export function projectCaseFlow(value: ChangeCase, run?: AgentRunSnapshot): Readonly<{
  nodes: ChangeNode[];
  edges: ChangeEdge[];
}> {
  const nodes = stageNodes(value, run);
  const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: "LR", ranksep: 72, nodesep: 32, marginx: 24, marginy: 24 });
  for (const node of nodes) graph.setNode(node.id, { width, height });
  const edges: ChangeEdge[] = nodes.slice(0, -1).map((node, index) => {
    const target = nodes[index + 1]!;
    graph.setEdge(node.id, target.id);
    return {
      id: `${node.id}-${target.id}`, source: node.id, target: target.id, type: "smoothstep",
      data: { status: target.data.status }, markerEnd: { type: MarkerType.ArrowClosed },
      animated: target.data.status === "active", selectable: true, focusable: true,
      ariaLabel: `${node.data.label} to ${target.data.label}: ${target.data.status}`,
    };
  });
  dagre.layout(graph);
  for (const node of nodes) {
    const position = graph.node(node.id) as { x: number; y: number };
    node.position = { x: position.x - width / 2, y: position.y - height / 2 };
  }
  return { nodes, edges };
}
