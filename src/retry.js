/**
 * Retries fn() on rejection while isRetryable(err) is true, up to `retries` additional
 * attempts (retries=3 means up to 4 total calls). Exponential backoff with full jitter
 * (delay = random(0, baseDelayMs * 2^attempt)) to avoid synchronized retry storms.
 */
async function withRetry(fn, { retries = 3, baseDelayMs = 500, isRetryable = () => true, onRetry } = {}) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !isRetryable(err)) throw err;
      const delayMs = Math.floor(Math.random() * baseDelayMs * 2 ** attempt);
      if (onRetry) onRetry(err, attempt + 1, delayMs);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      attempt++;
    }
  }
}

module.exports = { withRetry };
