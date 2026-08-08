import type { FastifyAdapter } from "@nestjs/platform-fastify";

/**
 * Parse JSON while preserving the exact request bytes for webhook proxy HMAC.
 * Attaches `request.rawBody` as a utf8 string.
 */
export function attachRawJsonBodyParser(fastifyAdapter: FastifyAdapter): void {
  const instance = fastifyAdapter.getInstance();

  instance.removeContentTypeParser("application/json");
  instance.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (request, body, done) => {
      const raw = Buffer.isBuffer(body) ? body.toString("utf8") : String(body ?? "");
      (request as { rawBody?: string }).rawBody = raw;

      if (!raw || !raw.trim()) {
        done(null, undefined);
        return;
      }

      try {
        done(null, JSON.parse(raw));
      } catch (err) {
        done(err as Error, undefined);
      }
    }
  );
}
