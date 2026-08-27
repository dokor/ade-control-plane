export class DatabaseRecordNotFoundError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "DatabaseRecordNotFoundError";
  }
}

export class LeaseConflictError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "LeaseConflictError";
  }
}

export class ExecutionCompletionConflictError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ExecutionCompletionConflictError";
  }
}
