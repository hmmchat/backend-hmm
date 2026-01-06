import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpStatus,
  BadRequestException
} from "@nestjs/common";
import { FastifyReply } from "fastify";
import { ZodError } from "zod";

@Catch(ZodError)
export class ZodExceptionFilter implements ExceptionFilter {
  catch(exception: ZodError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();

    const errors = exception.errors.map((err) => ({
      path: err.path.join("."),
      message: err.message
    }));

    response.status(HttpStatus.BAD_REQUEST).send({
      statusCode: HttpStatus.BAD_REQUEST,
      message: "Validation failed",
      errors
    });
  }
}

@Catch(BadRequestException)
export class BadRequestExceptionFilter implements ExceptionFilter {
  catch(exception: BadRequestException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    // Ensure proper response format for Fastify
    const responseBody = typeof exceptionResponse === 'string' 
      ? { statusCode: status, message: exceptionResponse }
      : { statusCode: status, ...(typeof exceptionResponse === 'object' ? exceptionResponse : { message: exceptionResponse }) };

    response.status(status).send(responseBody);
  }
}
