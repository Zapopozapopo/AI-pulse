/** Domain errors thrown by services; mapped to HTTP status codes by DomainExceptionFilter. */
export abstract class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** The request itself is malformed (bad id, bad cursor). */
export class ValidationError extends DomainError {}

export class NotFoundError extends DomainError {}

export class ConflictError extends DomainError {}

export class InvalidStateError extends DomainError {}
