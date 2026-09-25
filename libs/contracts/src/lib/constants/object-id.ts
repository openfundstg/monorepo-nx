/**
 * The shape of a Mongo document's id — the id in every route segment that
 * names a record, from a sale's status page to a top-up's.
 *
 * Shared because it is drawn twice outside the database: a demo account's pack
 * on the server and its acted-out records on the device each mint ids that
 * have to look like the real ones.
 */
export const OBJECT_ID_ALPHABET = '0123456789abcdef';

/** Twelve bytes, hex-encoded. */
export const OBJECT_ID_LENGTH = 24;
