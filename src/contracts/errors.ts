export class DomainError extends Error {
  code: string; status: number; paths: string[]; currentRevision?: number;
  constructor(code: string, message: string, status = 422, paths: string[] = [], currentRevision?: number) {
    super(message); this.code = code; this.status = status; this.paths = paths; this.currentRevision = currentRevision;
  }
  toJSON() {
    return { ok: false, error: { code: this.code, message: this.message, paths: this.paths, currentRevision: this.currentRevision, retryable: this.status === 503 || this.status === 429, recovery: this.status === 409 ? 'Read the latest context and review the intended change before submitting a new request.' : this.status === 401 ? 'Authenticate with a valid credential.' : 'Check the command contract and granted permissions.' } };
  }
}
export function ensure(condition: unknown, code: string, message: string, status = 422, paths: string[] = [], revision?: number): asserts condition {
  if (!condition) throw new DomainError(code, message, status, paths, revision);
}
