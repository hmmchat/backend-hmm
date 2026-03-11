import { createLocalJWKSet, SignJWT, jwtVerify, JWK, JWTPayload } from "jose";
import { z } from "zod";

// Export service client and discovery
export { ServiceClient, type ServiceClientConfig, type CircuitBreakerState } from "./service-client.js";
export { ServiceDiscovery, type ServiceEndpoint } from "./service-discovery.js";
export { HealthChecker, type HealthCheckResult } from "./health-check.js";

/* ---------- Types ---------- */
export type Provider = "google" | "apple" | "facebook" | "phone";

export interface AccessPayload extends JWTPayload {
  sub: string;          // user id
  uid: string;          // user id (duplicate for convenience)
  roles?: string[];     // future use
}

export const PreferenceSchema = z.object({
  videoEnabled: z.boolean().default(true),
  meetMode: z.enum(["both", "location"]).default("both"),
  location: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180)
    })
    .optional()
});

/* ---------- JWT helpers (EdDSA) ---------- */
export const JWT_ISSUER = "hmm.app";
export const JWT_AUDIENCE = "hmm.clients";

export async function signAccessToken(
  privateKeyPEM: string,
  payload: Omit<AccessPayload, "iss" | "aud" | "exp" | "iat">
) {
  const pk = await importPK(privateKeyPEM);
  return await new SignJWT(payload as AccessPayload)
    .setProtectedHeader({ alg: "EdDSA" })
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(pk);
}

export async function signRefreshToken(
  privateKeyPEM: string,
  payload: Pick<AccessPayload, "sub" | "uid">
) {
  const pk = await importPK(privateKeyPEM);
  return await new SignJWT(payload as AccessPayload)
    .setProtectedHeader({ alg: "EdDSA" })
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(pk);
}

export async function verifyToken(publicJwk: JWK | JWK[]) {
  const JWKS = createLocalJWKSet({ keys: Array.isArray(publicJwk) ? publicJwk : [publicJwk] });
  return async (token: string) => {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE
    });
    return payload as AccessPayload;
  };
}

async function importPK(pem: string) {
  const b64 = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");

  const buf = Buffer.from(b64, "base64");

  return await crypto.subtle.importKey(
    "pkcs8",
    buf,
    { name: "Ed25519", namedCurve: "Ed25519" } as any,
    false,
    ["sign"]
  );
}