/**
 * Format of the human-readable identifier every sale carries.
 *
 * It is the code a user reads out to support and the code embedded in the
 * terminal name (`TMA-<publicId>`), so the alphabet and length are a contract:
 * the backend generates against them and the Mini App renders the result.
 *
 * Digits plus uppercase Latin letters, e.g. `Z38SL69F`. The full 36-character
 * alphabet is deliberate — it matches the agreed format rather than a reduced
 * unambiguous set, so `0`/`O` and `1`/`I` can both occur.
 */
export const PUBLIC_ID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** 36^8 ≈ 2.8e12 — collisions are handled by a unique index plus retry, not by luck. */
export const PUBLIC_ID_LENGTH = 8;

/** Matches a well-formed public id end to end. */
export const PUBLIC_ID_PATTERN = /^[0-9A-Z]{8}$/;
