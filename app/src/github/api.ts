export interface GitHubApiConfig {
  readonly token: string;
  readonly baseUrl?: string;
}

export class GitHubApiError extends Error {
  override readonly name = "GitHubApiError";
  constructor(message: string, readonly status?: number, options?: ErrorOptions) {
    super(message, options);
  }
}

type RequestOptions = Readonly<{
  method?: "GET" | "POST" | "PATCH";
  body?: Readonly<Record<string, unknown>>;
  expected?: readonly number[];
}>;

export class GitHubApi {
  private readonly baseUrl: URL;
  private readonly token: string;

  constructor(config: GitHubApiConfig) {
    if (!config.token.trim()) throw new GitHubApiError("GitHub token must be non-empty");
    this.token = config.token;
    this.baseUrl = new URL(config.baseUrl ?? "https://api.github.com");
    if (
      this.baseUrl.protocol !== "https:"
      && this.baseUrl.hostname !== "127.0.0.1"
      && this.baseUrl.hostname !== "localhost"
    ) {
      throw new GitHubApiError("remote GitHub API URL must use HTTPS");
    }
  }

  private url(path: string): URL {
    if (!path.startsWith("/")) throw new GitHubApiError("GitHub API path must be absolute");
    const result = new URL(path, this.baseUrl);
    if (result.origin !== this.baseUrl.origin) throw new GitHubApiError("cross-origin GitHub API request refused");
    return result;
  }

  private async request(path: string, options: RequestOptions = {}): Promise<{
    readonly response: Response;
    readonly value: unknown;
  }> {
    const method = options.method ?? "GET";
    const response = await fetch(this.url(path), {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "cutset-governed-change",
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    }).catch((error: unknown) => {
      throw new GitHubApiError("GitHub API request failed", undefined, { cause: error });
    });
    const expected = options.expected ?? [200];
    if (!expected.includes(response.status)) {
      throw new GitHubApiError(`GitHub API returned HTTP ${response.status}`, response.status);
    }
    if (response.status === 204) return { response, value: undefined };
    try {
      return { response, value: await response.json() as unknown };
    } catch (error) {
      throw new GitHubApiError("GitHub API returned invalid JSON", response.status, { cause: error });
    }
  }

  async get(path: string): Promise<unknown> {
    return (await this.request(path)).value;
  }

  async getVoid(path: string, expected: readonly number[]): Promise<void> {
    await this.request(path, { expected });
  }

  async post(path: string, body: Readonly<Record<string, unknown>>): Promise<unknown> {
    return (await this.request(path, { method: "POST", body, expected: [200, 201] })).value;
  }

  async patch(path: string, body: Readonly<Record<string, unknown>>): Promise<unknown> {
    return (await this.request(path, { method: "PATCH", body, expected: [200] })).value;
  }

  async paginate(path: string): Promise<readonly unknown[]> {
    const values: unknown[] = [];
    let next: string | undefined = path;
    const visited = new Set<string>();
    while (next !== undefined) {
      if (visited.has(next)) throw new GitHubApiError("GitHub pagination cycle detected");
      visited.add(next);
      const { response, value } = await this.request(next);
      if (!Array.isArray(value)) throw new GitHubApiError("GitHub paginated response was not a list");
      values.push(...value);
      const link = response.headers.get("link");
      next = undefined;
      if (link) {
        for (const part of link.split(",")) {
          const match = /^\s*<([^>]+)>;\s*rel="([^"]+)"\s*$/.exec(part);
          if (match?.[2] !== "next" || !match[1]) continue;
          const url = new URL(match[1], this.baseUrl);
          if (url.origin !== this.baseUrl.origin) throw new GitHubApiError("cross-origin GitHub pagination refused");
          next = `${url.pathname}${url.search}`;
        }
      }
    }
    return values;
  }
}
