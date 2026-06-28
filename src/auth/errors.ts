/**
 * Authorization outcomes for the scoping layer (U4, R66/R70).
 *
 * - `NotFoundError` — the target is OUTSIDE the requester's visible set. Reads,
 *   updates, and deletes of unseen records return not-found so existence is
 *   never revealed (R9, R70).
 * - `NotAuthorizedError` — the target IS visible but the requester lacks the
 *   right for this operation (e.g. a view-grantee trying to edit, an edit-
 *   grantee trying to delete, or create-on-behalf without the flag). Existence
 *   is already known, so this is a forbidden, not a not-found.
 */
export class NotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class NotAuthorizedError extends Error {
  constructor(message = "Not authorized") {
    super(message);
    this.name = "NotAuthorizedError";
  }
}
