/** Errors services raise for handlers to translate into HTTP statuses. */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class InvalidRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRequestError";
  }
}

/** Authenticated, but this credential's role may not do this. */
export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** The family has not been set up yet (no settings). */
export class NotConfiguredError extends Error {
  constructor(message = "Settings have not been configured yet") {
    super(message);
    this.name = "NotConfiguredError";
  }
}

/** The request conflicts with current state (e.g. an app version that is not newer). */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

/** Too many requests of this kind from this caller for now. */
export class RateLimitedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitedError";
  }
}
