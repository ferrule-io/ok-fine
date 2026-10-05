export class OkfError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, status: number, message: string, details?: unknown) {
    super(message);
    this.name = "OkfError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
