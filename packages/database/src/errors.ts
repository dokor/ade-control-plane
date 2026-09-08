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

export class ActiveTaskConflictError extends Error {
  public constructor() {
    super("Another V0 task is already active.");
    this.name = "ActiveTaskConflictError";
  }
}

export class TaskNotTerminalError extends Error {
  public constructor(taskId: string) {
    super(`V0 task ${taskId} must be terminal before it can be archived.`);
    this.name = "TaskNotTerminalError";
  }
}
