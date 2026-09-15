/**
 * One migration: a change to the *data* that a deploy cannot make on its own.
 *
 * Ordinary schema changes need nothing here — Mongo has no DDL and Mongoose
 * builds indexes on boot. What belongs here is history: a collection that has
 * to be filled from what other collections already know, a field that has to be
 * derived onto documents written before it existed, a value that has to be
 * corrected in place.
 *
 * Three rules, none of which the framework can enforce for you:
 *
 * - **Idempotent.** A run that dies halfway leaves no record, so the next one
 *   starts from the top. Write every migration as though it will run twice —
 *   with a dedupe key, an `upsert`, or a filter that skips what is already
 *   done.
 * - **Read the world as it is, not as the code expects it.** A migration runs
 *   against documents written by older code. Fields the current type declares
 *   as present may be missing.
 * - **The name never changes.** It is the identity the `migrations` collection
 *   records; renaming one that has run anywhere makes it run again.
 */
export interface Migration {
  /**
   * `0001-backfill-balance-entries` — ordering prefix, then what it does.
   *
   * The prefix is for reading the directory; the actual order is the order of
   * `MIGRATIONS`, which is explicit because a bundled app has no directory to
   * scan at runtime.
   */
  readonly name: string

  /** Applies it. Returns one line saying what it did, for the log and the record. */
  up(): Promise<string>

  /**
   * Undoes it, where undoing is a thing that can be done.
   *
   * Optional, and honestly so: most data migrations cannot be reversed, and a
   * `down` that silently does half the job is worse than none. Implement it
   * when the migration's work is identifiable — rows it wrote and nothing else
   * touches — which is exactly the case that makes `down` + fix + `up` the
   * fastest way to correct a backfill.
   */
  down?(): Promise<string>
}
