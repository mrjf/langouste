/**
 * Shared setup for service tests that exercise the database contract through
 * the ephemeral turbopuffer transport test double.
 *
 * Config reads process.env at module-evaluation time, so this file must remain
 * the first import in DB-using test files.
 */
process.env.ANTHROPIC_API_KEY ||= "test-key";
process.env.LANGOUSTE_JWT_SECRET ||= "test-secret";
process.env.LANGOUSTE_TEST_MODE ??= "true";
process.env.LANGOUSTE_TEST_STORAGE ??= "memory";
process.env.LANGOUSTE_STUB_AI ??= "true";
