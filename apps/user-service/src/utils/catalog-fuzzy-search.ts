import { Prisma } from "../../node_modules/.prisma/client/index.js";

function likePattern(query: string, { prefixOnly = false, compact = false } = {}) {
  const normalized = (compact ? query.replace(/\s+/g, "") : query)
    .toLowerCase()
    .replace(/[%_\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  return prefixOnly ? `${normalized}%` : `%${normalized}%`;
}

export function catalogFuzzyWhere(query: string) {
  const likeContains = likePattern(query);
  const likeCompact = likePattern(query, { compact: true });
  const clauses = [
    Prisma.sql`similarity(lower(name), lower(${query})) >= 0.18`,
    Prisma.sql`word_similarity(lower(${query}), lower(name)) >= 0.3`,
  ];
  if (likeContains) {
    clauses.unshift(Prisma.sql`lower(name) LIKE ${likeContains}`);
  }
  if (likeCompact && likeCompact !== likeContains) {
    clauses.unshift(Prisma.sql`replace(lower(name), ' ', '') LIKE ${likeCompact}`);
  }
  return Prisma.join(clauses, " OR ");
}

export function catalogFuzzyOrderBy(query: string) {
  const likePrefix = likePattern(query, { prefixOnly: true });
  const prefixRank = likePrefix
    ? Prisma.sql`(lower(name) LIKE ${likePrefix}) DESC`
    : Prisma.sql`false DESC`;
  return Prisma.sql`
    (lower(name) = lower(${query})) DESC,
    ${prefixRank},
    GREATEST(
      similarity(lower(name), lower(${query})),
      word_similarity(lower(${query}), lower(name))
    ) DESC,
    name ASC
  `;
}

export function catalogFuzzyFallbackOrderBy(query: string) {
  return Prisma.sql`
    GREATEST(
      similarity(lower(name), lower(${query})),
      word_similarity(lower(${query}), lower(name))
    ) DESC,
    name ASC
  `;
}
