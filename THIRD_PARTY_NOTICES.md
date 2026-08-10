# Third-Party Notices

## DataHub Agent Starter

Hadal began from the DataHub Agent Starter by Lakshay Nasa. The preserved
Python import namespace remains `cutset` for backward compatibility:

https://github.com/lakshay-nasa/datahub-agent-starter

The starter was provided under the MIT License:

> MIT License
>
> Copyright (c) 2026 Lakshay Nasa
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

## Runtime libraries

Hadal installs these libraries from their published packages; it does
not vendor their source or model weights in this repository. Their package
licenses and notices remain present after `npm ci`.

- Vercel AI SDK 7 (`ai`), Apache-2.0 — https://github.com/vercel/ai
- QVAC AI SDK provider and CLI (`@qvac/ai-sdk-provider`, `@qvac/cli`),
  Apache-2.0 — https://github.com/tetherto/qvac
- React Flow (`@xyflow/react`), MIT — https://github.com/xyflow/xyflow
- Model Context Protocol TypeScript SDK (`@modelcontextprotocol/sdk`), MIT —
  https://github.com/modelcontextprotocol/typescript-sdk

The QVAC model artifact is downloaded at runtime from the exact registry source
declared by the installed provider and is not distributed with Hadal.

## Official DataHub resource evidence

The public examples contain only Hadal's sanitized observations and
real DataHub URNs; they do not redistribute the official databases, agent
packages, or repository source.

- DataHub Core and CLI, Apache-2.0 — https://github.com/datahub-project/datahub
- DataHub MCP Server, Apache-2.0 — https://github.com/acryldata/mcp-server-datahub
- DataHub Skills, Apache-2.0 — https://github.com/datahub-project/datahub-skills
- Analytics Agent, Apache-2.0 — https://github.com/datahub-project/analytics-agent
- NYC Taxi static-assets dataset, official source notes identify the underlying
  NYC Open Data records as public domain —
  https://github.com/datahub-project/static-assets/tree/main/datasets/nyc-taxi
