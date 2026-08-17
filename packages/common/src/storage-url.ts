/**
 * Rewrite expiring S3/B2 presigned GET URLs to the stable public download form.
 * Signed query params 403 after 7 days even when the bucket is public.
 */

export function rewrittenStorageUrlOrNull(
  url: string | null | undefined
): string | null {
  if (!url) return null;
  const next = rewriteExpiredStorageUrl(url);
  return next && next !== url ? next : null;
}

export function rewriteExpiredStorageUrl<T extends string | null | undefined>(
  url: T
): T {
  if (url == null || url === "") return url;
  try {
    const parsed = new URL(url);
    const signed =
      parsed.searchParams.has("X-Amz-Signature") ||
      parsed.searchParams.has("X-Amz-Algorithm") ||
      parsed.searchParams.has("X-Amz-Credential");

    const virtual = parsed.hostname.match(
      /^([^.]+)\.s3\.([a-z0-9-]+)\.backblazeb2\.com$/i
    );
    if (virtual) {
      const bucket = virtual[1];
      const native = nativeB2FileUrl(virtual[2], bucket, parsed.pathname);
      if (native) return native as T;
    }

    const pathStyle = parsed.hostname.match(/^s3\.([a-z0-9-]+)\.backblazeb2\.com$/i);
    if (pathStyle) {
      const path = parsed.pathname.replace(/^\//, "");
      const native = nativeB2FileUrl(pathStyle[1], "", path);
      if (native) return native as T;
    }

    if (signed) {
      return `${parsed.origin}${parsed.pathname}` as T;
    }

    return url;
  } catch {
    return url;
  }
}

export function resolvePublicStorageBase(opts: {
  publicUrl?: string | null;
  endpoint?: string | null;
  region?: string | null;
  bucketName?: string | null;
}): string {
  const publicUrl = trimTrailingSlash(opts.publicUrl);
  if (publicUrl && !isS3ApiHost(publicUrl)) {
    return publicUrl;
  }

  const fromEndpoint = nativeB2BaseFromHostOrUrl(opts.endpoint, opts.bucketName);
  if (fromEndpoint) return fromEndpoint;

  const fromRegion = nativeB2BaseFromRegion(opts.region, opts.bucketName);
  if (fromRegion) return fromRegion;

  if (publicUrl) {
    const derived = nativeB2BaseFromHostOrUrl(publicUrl, opts.bucketName);
    if (derived) return derived;
    return publicUrl;
  }

  return "";
}

function nativeB2FileUrl(
  region: string,
  bucket: string,
  pathname: string
): string | null {
  const cluster = region.match(/(\d{3})$/)?.[1];
  if (!cluster) return null;
  const path = pathname.replace(/^\//, "");
  if (!path) return null;
  if (bucket) {
    return `https://f${cluster}.backblazeb2.com/file/${bucket}/${path}`;
  }
  return `https://f${cluster}.backblazeb2.com/file/${path}`;
}

function nativeB2BaseFromRegion(
  region: string | null | undefined,
  bucketName: string | null | undefined
): string {
  if (!region || !bucketName) return "";
  const cluster = region.match(/(\d{3})$/)?.[1];
  if (!cluster) return "";
  return `https://f${cluster}.backblazeb2.com/file/${bucketName}`;
}

function nativeB2BaseFromHostOrUrl(
  hostOrUrl: string | null | undefined,
  bucketName: string | null | undefined
): string {
  if (!hostOrUrl || !bucketName) return "";
  try {
    const host = hostOrUrl.includes("://")
      ? new URL(hostOrUrl).hostname
      : hostOrUrl;
    const match = host.match(/^s3\.([a-z0-9-]+)\.backblazeb2\.com$/i);
    if (!match) return "";
    return nativeB2BaseFromRegion(match[1], bucketName);
  } catch {
    return "";
  }
}

function isS3ApiHost(publicUrl: string): boolean {
  try {
    const host = new URL(publicUrl).hostname;
    return /^s3\./i.test(host) && host.includes("backblazeb2.com");
  } catch {
    return false;
  }
}

function trimTrailingSlash(value: string | null | undefined): string {
  const trimmed = value?.trim() || "";
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}
