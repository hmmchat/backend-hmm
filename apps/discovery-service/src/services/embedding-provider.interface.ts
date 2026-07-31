/**
 * Provider-neutral interface for embedding generation.
 * The matching pipeline never calls this directly — it only reads
 * pre-computed vectors from the UserFeature table.
 * Embedding generation happens asynchronously when profile data changes.
 */

export interface EmbeddingProvider {
  /** Human-readable name of the provider (e.g. "hosted-v1", "local-minilm") */
  name: string;

  /**
   * Generate an embedding for a single text.
   * Returns a dense vector of floats.
   */
  generate(text: string): Promise<number[]>;

  /**
   * Generate embeddings for multiple texts in one batch.
   * Default implementation calls `generate` sequentially; providers
   * should override for true batching.
   */
  generateBatch(texts: string[]): Promise<number[][]>;

  /**
   * Estimated cost per 1,000 input tokens in INR.
   * Used by the cost tracker to accumulate spend.
   */
  estimatedCostPer1kTokensInr: number;
}

export interface EmbeddingInput {
  /** The text to embed (already de-identified) */
  text: string;
  /** SHA-256 hash of the input text — used for caching */
  hash: string;
  /** User ID for audit/debug (not sent to provider) */
  userId: string;
}