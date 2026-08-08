import type { FastifyInstance } from "fastify";

/**
 * Parse JSON while preserving the exact request bytes for Razorpay webhook HMAC.
 * Attaches `request.rawBody` as a utf8 string.
 *
 * Must run AFTER NestFactory.create (or with bodyParser: false), otherwise Nest
 * re-registers application/json and Fastify throws FST_ERR_CTP_ALREADY_PRESENT.
 */
export function attachRawJsonBodyParser(instance: FastifyInstance): void {
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
