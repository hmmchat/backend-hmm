/**
 * Profile photos live in a private Backblaze bucket. Friendly "public" URLs
 * return 401, and a presigned GET dies after 7 days. Hand clients a stable
 * media URL; files-service signs a fresh download when the image is loaded.
 */

const DEFAULT_PROFILE_PHOTO_MEDIA_BASE = "https://api.beam.place/v1/files/media";

/** Folders files-service writes. A path starting with one of these has no bucket prefix. */
const STORAGE_KEY_PREFIXES = [
  "profile-photos/",
  "uploads/",
  "friends-wall-share/",
  "gifts/",
  "zodiacs/",
  "memes/",
  "horoscopes/",
  "catalog/",
  "loading-memes/",
  "stickers/"
];

export function profilePhotoMediaBase(): string {
  const explicit = process.env.PROFILE_PHOTO_MEDIA_BASE?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  return DEFAULT_PROFILE_PHOTO_MEDIA_BASE;
}

export function deliveryUrlForStorageKey(key: string): string {
  return `${profilePhotoMediaBase()}?key=${encodeURIComponent(key)}`;
}

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
  const key = storageObjectKey(url);
  if (key) return deliveryUrlForStorageKey(key) as T;
  return url;
}

/**
 * Object key inside our bucket, parsed from a presigned S3 URL, a friendly
 * B2 URL, or a media URL we already handed out. Null for unrelated URLs
 * (zodiac CDN, brand logos).
 */
export function storageObjectKey(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.pathname.endsWith("/files/media")) {
    return sanitizeStorageKey(parsed.searchParams.get("key"));
  }

  const path = decodePath(parsed.pathname);
  const host = parsed.hostname;

  if (/^f\d+\.backblazeb2\.com$/i.test(host)) {
    const parts = path.split("/");
    if (parts[0] === "file" && parts.length >= 3) {
      return sanitizeStorageKey(parts.slice(2).join("/"));
    }
    return null;
  }

  if (/^[^.]+\.s3\.[a-z0-9-]+\.backblazeb2\.com$/i.test(host)) {
    return sanitizeStorageKey(path);
  }

  if (/^s3\.[a-z0-9-]+\.backblazeb2\.com$/i.test(host)) {
    return sanitizeStorageKey(stripBucketPrefix(path));
  }

  if (host.endsWith(".r2.cloudflarestorage.com") || host.endsWith(".amazonaws.com")) {
    return sanitizeStorageKey(stripBucketPrefix(path));
  }

  return null;
}

function stripBucketPrefix(path: string): string {
  if (!path) return "";
  if (STORAGE_KEY_PREFIXES.some((prefix) => path.startsWith(prefix))) return path;
  const slash = path.indexOf("/");
  if (slash <= 0) return "";
  return path.slice(slash + 1);
}

function decodePath(pathname: string): string {
  return pathname
    .replace(/^\//, "")
    .split("/")
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    })
    .join("/");
}

export function sanitizeStorageKey(key: string | null | undefined): string | null {
  if (!key) return null;
  let decoded = key.trim();
  try {
    if (decoded.includes("%")) decoded = decodeURIComponent(decoded);
  } catch {
    return null;
  }
  if (!decoded || decoded.length > 1024) return null;
  if (decoded.startsWith("/") || decoded.includes("\\")) return null;
  if (/[\u0000-\u001f\u007f]/.test(decoded)) return null;
  if (decoded.split("/").some((part) => part === "" || part === "." || part === "..")) return null;
  return decoded;
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
