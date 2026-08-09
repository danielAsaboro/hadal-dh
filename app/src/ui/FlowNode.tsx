import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

import type { ChangeNode } from "./flow-model";

export const FlowNode = memo(function FlowNode({ data, selected }: NodeProps<ChangeNode>) {
  return (
    <article className={`flow-node flow-node-${data.status}${selected ? " selected" : ""}`}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="flow-node-top"><span>{data.eyebrow}</span><i aria-hidden="true" /></div>
      <strong>{data.label}</strong>
      <small>{data.detail}</small>
      <span className={`flow-state flow-state-${data.status}`}>{data.status}</span>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </article>
  );
});
