import {
  ProjectionState,
  type ChangeCase,
} from "../domain/case";
import { array, record, text } from "../datahub/normalize";
import { GitHubApi, GitHubApiError } from "./api";
import { caseMarker, workKeysIn, workMarker } from "./markers";

type Projection = ChangeCase["externalProjections"][number];

export class GitHubConnectorError extends Error {
  override readonly name = "GitHubConnectorError";
}

function connectorError(error: unknown): GitHubConnectorError {
  if (error instanceof GitHubConnectorError) return error;
  const message = error instanceof GitHubApiError ? error.message : "GitHub connector operation failed";
  return new GitHubConnectorError(message, { cause: error });
}

function repositoryParts(repository: string): readonly [string, string] {
  const parts = repository.split("/");
  if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_.-]+$/.test(part ?? ""))) {
    throw new GitHubConnectorError("repository must be an owner/name GitHub slug");
  }
  return [parts[0] as string, parts[1] as string];
}

function issueBody(value: ChangeCase, work: ChangeCase["workItems"][number]): string {
  const affected = work.affectedUrns.map((urn) => `- \`${urn}\``).join("\n");
  const criteria = work.completionCriteria.map((criterion) => `- [ ] ${criterion.replaceAll("\n", " ")}`).join("\n");
  return [
    `# ${work.title}`,
    "",
    `ChangeMarshal case \`${value.caseKey}\` requires this work for Git head \`${value.revision.headSha}\`.`,
    "",
    "## Affected DataHub assets",
    "",
    affected,
    "",
    "## Machine-verifiable completion criteria",
    "",
    criteria,
    "",
    "Closing this issue is not completion evidence. ChangeMarshal requires a current validation receipt and governed approval.",
    "",
    workMarker(work.workKey),
    caseMarker(value),
  ].join("\n");
}

function normalizeIssue(value: unknown) {
  const issue = record(value, "GitHub issue");
  const assignee = record(issue.assignee, "GitHub issue assignee");
  const number = issue.number;
  if (!Number.isInteger(number) || (number as number) < 1) throw new GitHubConnectorError("GitHub issue omitted its number");
  return {
    number: number as number,
    title: text(issue.title, "GitHub issue title"),
    body: text(issue.body, "GitHub issue body"),
    state: text(issue.state, "GitHub issue state"),
    assignee: text(assignee.login, "GitHub issue assignee login"),
    url: text(issue.html_url, "GitHub issue URL"),
  };
}

function normalizeLogin(value: unknown, label: string): string {
  return text(record(value, label).login, `${label} login`);
}

function normalizeReview(value: unknown) {
  const review = record(value, "GitHub pull-request review");
  const id = review.id;
  if (!Number.isInteger(id) || (id as number) < 1) {
    throw new GitHubConnectorError("GitHub review omitted its id");
  }
  const url = text(review.html_url, "GitHub review URL");
  try {
    new URL(url);
  } catch (error) {
    throw new GitHubConnectorError("GitHub review omitted a valid URL", { cause: error });
  }
  return {
    id: id as number,
    login: normalizeLogin(review.user, "GitHub review user"),
    state: text(review.state, "GitHub review state").toUpperCase(),
    commitId: text(review.commit_id, "GitHub review commit id"),
    submittedAt: text(review.submitted_at, "GitHub review submitted timestamp"),
    url,
  };
}

export class GitHubConnector {
  private readonly owner: string;
  private readonly name: string;
  private readonly repoPath: string;

  constructor(
    private readonly api: GitHubApi,
    repository: string,
    private readonly pullNumber: number,
  ) {
    [this.owner, this.name] = repositoryParts(repository);
    if (!Number.isInteger(pullNumber) || pullNumber < 1) throw new GitHubConnectorError("pull number must be positive");
    this.repoPath = `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.name)}`;
  }

  private mappings(value: ChangeCase): ReadonlyMap<string, string> {
    const mappings = new Map<string, string>();
    for (const [owner, login] of value.ownerMappings) {
      if (mappings.has(owner) && mappings.get(owner) !== login) {
        throw new GitHubConnectorError(`owner has ambiguous GitHub mappings: ${owner}`);
      }
      mappings.set(owner, login);
    }
    for (const work of value.workItems) {
      if (!mappings.has(work.ownerUrn)) {
        throw new GitHubConnectorError(`owner has no GitHub mapping: ${work.ownerUrn}`);
      }
    }
    return mappings;
  }

  async preflightCase(value: ChangeCase): Promise<ReadonlyMap<string, string>> {
    try {
      if (!value.evidence.complete) throw new GitHubConnectorError("complete DataHub evidence is required");
      const mappings = this.mappings(value);
      const repository = record(await this.api.get(this.repoPath), "GitHub repository");
      if (repository.full_name !== value.repository || value.repository !== `${this.owner}/${this.name}`) {
        throw new GitHubConnectorError("GitHub repository identity does not match the case");
      }
      const pull = record(await this.api.get(`${this.repoPath}/pulls/${this.pullNumber}`), "GitHub pull request");
      const head = record(pull.head, "GitHub pull request head");
      if (head.sha !== value.revision.headSha) throw new GitHubConnectorError("GitHub pull-request head SHA is stale");
      const logins = [...new Set(value.workItems.map((work) => mappings.get(work.ownerUrn) as string))].sort();
      for (const login of logins) {
        try {
          await this.api.getVoid(`${this.repoPath}/assignees/${encodeURIComponent(login)}`, [204]);
        } catch (error) {
          throw new GitHubConnectorError(`mapped owner is not an eligible assignee: ${login}`, { cause: error });
        }
      }
      return mappings;
    } catch (error) {
      throw connectorError(error);
    }
  }

  private async indexedIssues(): Promise<ReadonlyMap<string, ReturnType<typeof normalizeIssue>>> {
    const values = await this.api.paginate(`${this.repoPath}/issues?state=all&per_page=100`);
    const matches = new Map<string, ReturnType<typeof normalizeIssue>>();
    for (const value of values) {
      const issueRecord = record(value, "GitHub issue");
      if (issueRecord.pull_request !== undefined) continue;
      const issue = normalizeIssue(issueRecord);
      for (const key of workKeysIn(issue.body)) {
        if (matches.has(key)) throw new GitHubConnectorError(`duplicate GitHub issues for work key ${key}`);
        matches.set(key, issue);
      }
    }
    return matches;
  }

  private verifyIssue(
    value: ChangeCase,
    work: ChangeCase["workItems"][number],
    login: string,
    rawIssue: unknown,
    verifiedAt: string,
  ): Projection {
    const issue = normalizeIssue(rawIssue);
    const expectedBody = issueBody(value, work);
    if (
      issue.title !== `[ChangeMarshal] ${work.title}`
      || issue.body !== expectedBody
      || issue.state !== "open"
      || issue.assignee !== login
      || workKeysIn(issue.body).length !== 1
    ) {
      throw new GitHubConnectorError(`GitHub issue reread did not verify work key ${work.workKey}`);
    }
    try {
      new URL(issue.url);
    } catch (error) {
      throw new GitHubConnectorError("GitHub issue omitted a valid external URL", { cause: error });
    }
    return {
      system: "github",
      workKey: work.workKey,
      externalId: String(issue.number),
      url: issue.url,
      state: ProjectionState.Verified,
      revisionKey: value.revision.revisionKey,
      headSha: value.revision.headSha,
      assignee: login,
      verifiedAt,
    };
  }

  async syncWork(value: ChangeCase, verifiedAt: string): Promise<readonly Projection[]> {
    try {
      const mappings = await this.preflightCase(value);
      const indexed = await this.indexedIssues();
      const desired = value.workItems.map((work) => ({
        work,
        login: mappings.get(work.ownerUrn) as string,
        existing: indexed.get(work.workKey),
        title: `[ChangeMarshal] ${work.title}`,
        body: issueBody(value, work),
      }));
      const projections: Projection[] = [];
      for (const item of desired) {
        const raw = item.existing === undefined
          ? await this.api.post(`${this.repoPath}/issues`, {
              title: item.title,
              body: item.body,
              assignees: [item.login],
            })
          : await this.api.patch(`${this.repoPath}/issues/${item.existing.number}`, {
              title: item.title,
              body: item.body,
              assignees: [item.login],
              state: "open",
            });
        const mutated = normalizeIssue(raw);
        const reread = await this.api.get(`${this.repoPath}/issues/${mutated.number}`);
        projections.push(this.verifyIssue(value, item.work, item.login, reread, verifiedAt));
      }
      return projections.sort((left, right) => left.workKey.localeCompare(right.workKey));
    } catch (error) {
      throw connectorError(error);
    }
  }

  async reconcileWork(value: ChangeCase, verifiedAt: string): Promise<readonly Projection[]> {
    try {
      const mappings = await this.preflightCase(value);
      const indexed = await this.indexedIssues();
      return value.workItems.map((work) => {
        const issue = indexed.get(work.workKey);
        if (issue === undefined) throw new GitHubConnectorError(`GitHub issue is missing for work key ${work.workKey}`);
        return this.verifyIssue(value, work, mappings.get(work.ownerUrn) as string, issue, verifiedAt);
      }).sort((left, right) => left.workKey.localeCompare(right.workKey));
    } catch (error) {
      throw connectorError(error);
    }
  }

  private approvalLogins(value: ChangeCase, mappings: ReadonlyMap<string, string>): readonly string[] {
    return [...new Set(value.approvalRequirements.map((requirement) => {
      const login = mappings.get(requirement.ownerUrn);
      if (login === undefined) {
        throw new GitHubConnectorError(`approval owner has no GitHub mapping: ${requirement.ownerUrn}`);
      }
      return login;
    }))].sort();
  }

  private async verifyReviewerPermissions(logins: readonly string[]): Promise<void> {
    for (const login of logins) {
      const response = record(
        await this.api.get(`${this.repoPath}/collaborators/${encodeURIComponent(login)}/permission`),
        "GitHub reviewer permission",
      );
      const permission = text(response.permission, "GitHub reviewer permission");
      if (!new Set(["admin", "maintain", "write"]).has(permission)) {
        throw new GitHubConnectorError(`mapped approval owner lacks write permission: ${login}`);
      }
    }
  }

  private async currentReviews(value: ChangeCase) {
    return (await this.api.paginate(`${this.repoPath}/pulls/${this.pullNumber}/reviews?per_page=100`))
      .map(normalizeReview)
      .filter((review) => review.commitId === value.revision.headSha);
  }

  async syncApprovalRequests(value: ChangeCase): Promise<void> {
    try {
      const mappings = await this.preflightCase(value);
      const logins = this.approvalLogins(value, mappings);
      await this.verifyReviewerPermissions(logins);
      const reviewed = new Set((await this.currentReviews(value))
        .filter((review) => new Set(["APPROVED", "CHANGES_REQUESTED"]).has(review.state))
        .map((review) => review.login));
      const requestedResponse = record(
        await this.api.get(`${this.repoPath}/pulls/${this.pullNumber}/requested_reviewers`),
        "GitHub requested reviewers",
      );
      const requested = new Set(array(requestedResponse.users, "GitHub requested reviewer users")
        .map((user) => normalizeLogin(user, "GitHub requested reviewer")));
      const missing = logins.filter((login) => !requested.has(login) && !reviewed.has(login));
      if (missing.length > 0) {
        await this.api.post(`${this.repoPath}/pulls/${this.pullNumber}/requested_reviewers`, {
          reviewers: missing,
        });
      }
      const reread = record(
        await this.api.get(`${this.repoPath}/pulls/${this.pullNumber}/requested_reviewers`),
        "GitHub requested reviewers reread",
      );
      const verified = new Set(array(reread.users, "GitHub requested reviewer users reread")
        .map((user) => normalizeLogin(user, "GitHub requested reviewer reread")));
      const unresolved = logins.filter((login) => !verified.has(login) && !reviewed.has(login));
      if (unresolved.length > 0) {
        throw new GitHubConnectorError(`GitHub review request reread omitted governed reviewers: ${unresolved.join(", ")}`);
      }
    } catch (error) {
      throw connectorError(error);
    }
  }

  async reconcileApprovals(value: ChangeCase): Promise<ChangeCase["approvalDecisions"]> {
    try {
      const mappings = await this.preflightCase(value);
      const logins = this.approvalLogins(value, mappings);
      await this.verifyReviewerPermissions(logins);
      const latest = new Map<string, ReturnType<typeof normalizeReview>>();
      for (const review of await this.currentReviews(value)) {
        if (!logins.includes(review.login) || !new Set(["APPROVED", "CHANGES_REQUESTED", "DISMISSED"]).has(review.state)) {
          continue;
        }
        const previous = latest.get(review.login);
        if (previous === undefined || review.id > previous.id) latest.set(review.login, review);
      }
      return value.approvalRequirements.flatMap((requirement) => {
        const login = mappings.get(requirement.ownerUrn) as string;
        const review = latest.get(login);
        if (review === undefined || review.state === "DISMISSED") return [];
        return [{
          requirementKey: requirement.requirementKey,
          revisionKey: value.revision.revisionKey,
          headSha: value.revision.headSha,
          role: requirement.role,
          ownerUrn: requirement.ownerUrn,
          actorLogin: login,
          verdict: review.state === "APPROVED" ? "approve" as const : "reject" as const,
          decidedAt: new Date(review.submittedAt).toISOString(),
          source: "github" as const,
          externalId: String(review.id),
          url: review.url,
        }];
      }).sort((left, right) => left.actorLogin.localeCompare(right.actorLogin));
    } catch (error) {
      throw connectorError(error);
    }
  }

  async verifyActor(expectedLogin: string): Promise<Readonly<{ login: string; permission: string }>> {
    try {
      const user = record(await this.api.get("/user"), "GitHub user");
      const login = text(user.login, "GitHub user login");
      if (login !== expectedLogin) throw new GitHubConnectorError("authenticated GitHub actor does not match the governed owner mapping");
      const response = record(
        await this.api.get(`${this.repoPath}/collaborators/${encodeURIComponent(login)}/permission`),
        "GitHub repository permission",
      );
      const permission = text(response.permission, "GitHub permission");
      if (!new Set(["admin", "maintain", "write"]).has(permission)) {
        throw new GitHubConnectorError("authenticated GitHub actor lacks write permission");
      }
      return { login, permission };
    } catch (error) {
      throw connectorError(error);
    }
  }

  async publishAndVerifyStatus(headSha: string, allowed: boolean, targetUrl: string): Promise<void> {
    try {
      const state = allowed ? "success" : "failure";
      const body = {
        state,
        context: "changemarshal/governed-change",
        description: allowed ? "ChangeMarshal admission requirements satisfied" : "ChangeMarshal admission requirements are incomplete",
        target_url: targetUrl,
      };
      await this.api.post(`${this.repoPath}/statuses/${encodeURIComponent(headSha)}`, body);
      const combined = record(await this.api.get(`${this.repoPath}/commits/${encodeURIComponent(headSha)}/status`), "GitHub combined status");
      if (combined.sha !== headSha) throw new GitHubConnectorError("GitHub status reread returned a different SHA");
      const matches = array(combined.statuses, "GitHub statuses")
        .map((value) => record(value, "GitHub status"))
        .filter((status) => status.context === body.context);
      if (
        matches.length < 1
        || matches[0]?.state !== state
        || matches[0].target_url !== targetUrl
        || matches[0].description !== body.description
      ) {
        throw new GitHubConnectorError("GitHub commit status reread did not verify admission");
      }
    } catch (error) {
      throw connectorError(error);
    }
  }
}
