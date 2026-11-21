/** Statuses a person may set by hand. System statuses (queued, calling) and visit-workflow statuses
 * (visit_confirmed, visit_attended) are deliberately excluded: they change only through their own workflows. */
export const MANUAL_STATUSES = ["new", "connected", "interested", "callback_requested", "visit_requested", "not_interested", "wrong_number"] as const;
