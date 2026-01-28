import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from "@nestjs/common";
import { FastifyReply } from "fastify";
import { ZodError } from "zod";

@Catch()
export class ZodExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();

    if (exception instanceof ZodError) {
      const status = HttpStatus.BAD_REQUEST;
      const errors = exception.errors.map((err) => ({
        path: err.path.join("."),
        message: err.message
      }));

      response.status(status).send({
        statusCode: status,
        message: "Validation failed",
        errors
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      response.status(status).send(
        typeof exceptionResponse === "string"
          ? { statusCode: status, message: exceptionResponse }
          : exceptionResponse
      );
      return;
    }

    // Unknown error
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal server error"
    });
  }
}
