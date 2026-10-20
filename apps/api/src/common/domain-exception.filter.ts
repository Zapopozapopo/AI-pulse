import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { ConflictError, DomainError, InvalidStateError, NotFoundError, ValidationError } from './errors';

const statusFor = (error: DomainError): HttpStatus => {
  if (error instanceof ValidationError) return HttpStatus.BAD_REQUEST;
  if (error instanceof NotFoundError) return HttpStatus.NOT_FOUND;
  if (error instanceof ConflictError) return HttpStatus.CONFLICT;
  if (error instanceof InvalidStateError) return HttpStatus.UNPROCESSABLE_ENTITY;
  return HttpStatus.INTERNAL_SERVER_ERROR;
};

/** Keeps services free of HTTP concerns: they throw domain errors, this filter translates. */
@Catch(DomainError)
export class DomainExceptionFilter implements ExceptionFilter<DomainError> {
  catch(error: DomainError, host: ArgumentsHost): void {
    const status = statusFor(error);
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(status)
      .json({ statusCode: status, message: error.message, error: HttpStatus[status] });
  }
}
