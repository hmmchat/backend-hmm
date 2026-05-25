import type { FastifyAdapter } from "@nestjs/platform-fastify";

/** Allow POST with Content-Type: application/json and zero-length body (proxied admin unban, etc.). */
export function allowEmptyJsonBody(fastifyAdapter: FastifyAdapter): void {
  fastifyAdapter.getInstance().addHook("preParsing", (request, _reply, _payload, done) => {
    const contentType = request.headers["content-type"];
    const contentLength = request.headers["content-length"];
    const emptyLength = contentLength === "0" || contentLength === undefined || contentLength === "";

    if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(request.method) &&
      typeof contentType === "string" &&
      contentType.toLowerCase().includes("application/json") &&
      emptyLength
    ) {
      delete request.headers["content-type"];
    }
    done();
  });
}
