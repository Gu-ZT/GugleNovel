export class OpenAIConnection {
  constructor(
      private readonly endpoint: string,
      private readonly apiKey: string
  ) {
  }

  get baseUrl(): string {
    let base = this.endpoint.trim().replace(/\/+$/, "");
    if (!/\/v\d+(\/|$)/.test(base)) base += "/v1";
    return base;
  }

  get authHeaders(): Record<string, string> {
    return this.apiKey.trim() ? {Authorization: `Bearer ${this.apiKey.trim()}`} : {};
  }

  get jsonHeaders(): Record<string, string> {
    return {...this.authHeaders, "Content-Type": "application/json"};
  }

  static extractTextContent(value: unknown): string {
    if (typeof value === "string") return value;
    if (!Array.isArray(value)) return "";
    return value
        .filter((part): part is Record<string, unknown> => Boolean(part && typeof part === "object"))
        .map((part) => typeof part.text === "string" ? part.text : "")
        .filter(Boolean)
        .join("\n");
  }
}
