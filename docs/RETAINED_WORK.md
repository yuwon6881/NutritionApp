# Retained work contracts

Queue and draft writes apply an operation-identity delta to the latest account collection within one IndexedDB transaction. A stale tab cannot replace the whole collection or remove a newer draft version. Bulk food operations validate all destinations before one local transaction. Profile-local tomorrow is the latest food destination; archived meal details remain read-only.

Tabs announce durable changes through BroadcastChannel and reload retained partitions. An account-scoped IndexedDB lease coordinates dispatch; crashed-tab leases expire. Offline entry stays available. Mutation identities provide server idempotency independently of the lease.

Body draft versions use mutation IDs. Versions for a record dispatch in order. Every root save, upload and photo deletion persists its exact request before dispatch and its committed revision afterward. Retrying after a lost response uses the same payload; acknowledgement removes only that version and rebases its successor. Legacy partial drafts whose original requests cannot be reconstructed remain retained for review; they are never rebuilt into blind external writes.

Transient requests retain work and respect retry delays; 401 stops sending until sign-in. Recognized database constraint conflicts use 409; other write failures use retryable 503. Ordinary terminal edit rejection continues to remove the rejected operation and reload saved data.

Committed day, weight and Body acknowledgements are stored with their mutation receipts, so lost-response retries return the original identities and revisions. Older acknowledgements cannot overwrite newer cached records. Sync responses retain `revision` and add canonical dated day/weight rows. Reconciled diary decisions and deleted weigh-in restorations use those rows. Weight moves validate both revisions and atomically save the source, destination, trajectory and integration work.

Body-fat sync uses the actual Body record identity and saved after-state: missing measurement keys retain values and explicit null clears them. Legacy mappings are repaired only with an account-scoped matching mutation receipt, unchanged record revision, date and value. Ambiguous associations preserve Google copies, block blind new creates and report mapping review. No external cleanup is performed.

Check-in cadence has its own revision/date in account settings and accepted snapshots. Only weekday changes update cadence. The additive migration leaves unchanged weekdays at their existing cadence and carries the prior changed date when the latest accepted weekday differs. Accepted targets and equations are unchanged.
