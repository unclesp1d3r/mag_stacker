---
title: "A green review-bot check and a clean unresolved-thread count are not evidence a PR was reviewed"
date: 2026-08-08
category: workflow-issues
module: pr-review
problem_type: workflow_issue
component: development_workflow
severity: high
root_cause: missing_workflow_step
resolution_type: workflow_improvement
applies_when:
  - "Judging PR merge-readiness from a bot status check without confirming the review ran against the current head commit"
  - "Treating a '0 unresolved review threads' count as proof a PR carries no unresolved findings"
  - "Reading the GitHub reviews API to determine which commit a review pass actually covered"
  - "A PR is receiving rapid successive commits, which can trigger a review bot's auto-pause or fair-usage rate limiting"
  - "Reviewing CodeRabbit output that includes 'outside diff range' or 'nitpick' sections"
symptoms:
  - "A bot's status check reports pass while its review was auto-paused, having read nothing"
  - "An explicit review trigger returns 'Action not completed — Review rate limited', so the newest commit is never reviewed"
  - "A reviews-API row tagged with the head SHA but with an empty body is a thread reply, not a review pass"
  - "Findings posted only in a review body never surface as resolvable threads, so '0 unresolved' looks merge-ready while a real bug sits undiscovered"
related_components:
  - tooling
  - testing_framework
tags:
  - coderabbit
  - pr-review
  - ci-status-checks
  - false-positive
  - github-reviews-api
  - rate-limiting
  - unresolved-threads
  - review-automation
---

# A green review-bot check and a clean thread count are not proof a PR was reviewed

## Context

PR #106 carried a CodeRabbit status check reading "pass — Review completed" while CodeRabbit's own walkthrough comment stated the branch was under active development and that "CodeRabbit has automatically paused this review" to avoid overwhelming the author during a run of new commits. The green check reflected a review that never ran.

Triggering one explicitly with `@coderabbitai review` produced three findings, one a real data-integrity bug. `updateAccessory` read `currentFirearmId` and derived `installedDate` from it without a row lock, while `updateMagazine` (`src/domain/magazines/service.ts:191`) already locked its equivalent read with `.for("update")` for exactly that reason — two functions in the same PR, the same read-then-derive-then-write shape, only one closed against the race. Both now lock (`src/domain/accessories/service.ts:234`).

A second `@coderabbitai review` came back "Action not completed — Review rate limited," while the walkthrough comment updated its own banner to "Review limit reached" under CodeRabbit's Fair Usage Limits Policy. Two surfaces, two different strings, both meaning the newest commit went unreviewed — and the banner is the one that stays current, since CodeRabbit edits it in place. CodeRabbit also documents that it does not re-review already-reviewed commits, so a retry only ever covers what is new.

Separately, the reviews API was queried to confirm the head had been reviewed, and an entry tagged with the head SHA was read as evidence. Pulled during that session:

```text
2026-08-08T14:56:16Z coderabbitai[bot] bodylen=12487 commit=ccb6943
2026-08-08T15:03:10Z coderabbitai[bot] bodylen=0     commit=ffe3a9b
2026-08-08T15:05:55Z coderabbitai[bot] bodylen=0     commit=ffe3a9b
```

(Those SHAs are branch commits on PR #106, quoted verbatim so the shape is real; the squash merge rewrites them, so cite the PR — not these — as the durable reference.)

The `bodylen=0` rows are thread replies, not review passes. GitHub stamps a reply with whatever the PR head happens to be *at reply time*, which says nothing about which commit was read. The only genuine review pass is the `bodylen=12487` row, against an earlier commit. Across this PR's life the ratio is **5 non-empty review bodies to 29 zero-length rows** — a "latest row" read picks a reply almost every time.

CodeRabbit also files some findings inside review *bodies* rather than as inline comments — sections headed "Outside diff range comments" and "Nitpick comments." Neither has a resolve mechanism, and neither appears in an unresolved-thread count. On this PR that hid, at different points, both the missing row lock above and a separately confirmed silent data-loss bug. Twice — observed directly during the session, though GitHub exposes no historical thread-state timeline to reconstruct it after the fact — the thread count read 0 unresolved and the branch looked merge-ready while carrying a live bug that existed only in a review body nobody had opened.

## Guidance

Treat "the check is green" and "a review ran against this commit" as two separate claims, and verify the second directly.

**Check the bot's walkthrough comment for a pause or rate-limit banner first.** CodeRabbit edits that comment in place as state changes, so its current text is authoritative for the current moment. A banner reading "automatically paused" or "Review limit reached" means the passing check is stale by definition.

**To confirm a commit was reviewed, don't trust `commit_id` alone — check whether the review carries a body.** A real submission has a substantial body; a thread reply or command acknowledgment has none and can be stamped with any commit that was head when it posted:

```bash
gh api repos/OWNER/REPO/pulls/N/reviews \
  --jq '.[] | "\(.submitted_at) \(.user.login) bodylen=\(.body|length) commit=\(.commit_id)"'
```

Ignore every `bodylen=0` row, then match the last substantial row's commit against the real head (`gh pr view N --json headRefOid`). If they differ, the head has not been reviewed, whatever the status check says.

**Read review bodies, not just the thread count.** The count reflects only inline findings; "Outside diff range" and "Nitpick" sections live in the body and never become a thread:

```bash
gh api repos/OWNER/REPO/pulls/N/reviews \
  --jq '.[] | select((.body | length) > 0) | .body'
```

Thread state is a different API surface — `gh pr view --json` has no `reviewThreads` field (it errors with `Unknown JSON field`), so that check needs GraphQL:

```bash
gh api graphql -f query='
  query { repository(owner:"OWNER", name:"REPO") {
    pullRequest(number: N) {
      reviewThreads(first: 50) { nodes { isResolved } }
    }
  } }' --jq '.data.repository.pullRequest.reviewThreads.nodes
    | group_by(.isResolved) | map({resolved: .[0].isResolved, count: length})'
```

A clean result there says nothing about what is sitting in review bodies. Run both.

**Generalize past CodeRabbit.** For any automated reviewer wired into CI, ask: *what does this tool's success signal report when it did nothing?* A tool that reports pass on a no-op is indistinguishable at the status-check layer from one that reports pass on a clean review. GitHub Copilot's reviewer has the same shape by a different trigger — it silently reviews nothing on a PR over 20,000 changed lines (auto memory [claude]): no banner, no error, just a check that says nothing meaningful ran.

## Why This Matters

The status check and the walkthrough comment are different surfaces that update at different times and can disagree, and only one is designed to report whether a review pass occurred. The check reflects "the bot responded to this event" — which includes pausing, rate-limiting, or replying to a thread — not "the bot read this diff." Every failure mode above produces the same outward artifact: a passing check and, eventually, a clean thread count. None of them produce a review.

That is why the accessory locking bug survived as long as it did. The correct pattern already existed one file over, with a comment explaining the race. This was never a case of not knowing the fix; it was the review that would have caught the omission not running against the commit that introduced it — twice, for two different reasons.

## When to Apply

- Before merging any PR that leans on an automated reviewer as part of the "reviewed" signal — especially after a burst of commits, a rebase, or a force-push, which is exactly when these bots pause, rate-limit, or skip.
- When a check is green but comment volume looks low relative to the diff. That mismatch is the tell, not a reassurance.
- Whenever citing a `gh api .../reviews` entry as proof a commit was reviewed — check `bodylen` before citing it, not after something breaks.
- Whenever "0 unresolved threads" is doing work as a merge-readiness signal. Pair it with a read of the review bodies.
- When onboarding a new automated reviewer: before trusting its check as a gate, find out what it reports when it does nothing (rate limit, size limit, timeout, opt-out label) and confirm that state is visibly distinguishable from a real pass.

## Related

- [The data-loss bug this concealed](../logic-errors/a-viewer-relative-read-feeding-a-replace-all-write-destroys-hidden-rows.md) — the silent compatibility data loss that sat behind a clean thread count. That doc covers the code defect; this one covers why the process that should have surfaced it did not.
- Issue #107 — the TOCTOU finding from the same review, filed as an issue precisely so it would not be lost with its thread. It exists *because* of the mechanism described here.
- [A test timeout ends the pool and cascades](../test-failures/a-test-timeout-ends-the-pool-and-cascades-into-unrelated-failures.md) — a different mechanism with the same epistemic root. Its rule "distrust *passes in isolation* as exoneration" is this rule applied to a test suite: a green signal examined only at face value is not proof of the claim it appears to attest.
