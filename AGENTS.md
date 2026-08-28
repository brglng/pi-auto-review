## Ask before merging from upstream

Before modifying this package, ask the user whether to first
merge the latest upstream functionality. Before the merge, you must examine
the changes in the upstream after our fork point, show them to the user, and
clarify with the user on how to do the merge. You must provide several solutions
with you advice and recommendation.

When merging or updating from upstream, use the latest upstream release code
directly, preferably from the published release package or tarball. Do not use
Git for the upstream merge. Compare the code directly and merge at the
functional level. When a functional conflict arises during the merge, stop and
ask the user how to resolve it — do not resolve functional conflicts
unilaterally.

## Versioning

- If upstream's latest version is newer than ours, merge upstream first, then
  publish `X.Y.Z-brglng.1` (taking upstream's `X.Y.Z`). If upstream is not
  newer, bump current `-brglng.x` version to `-brglng.x+1`.
