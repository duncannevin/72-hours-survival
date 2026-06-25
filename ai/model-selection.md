# Model Selection Note

**Date:** 2026-06-24 
**Author:** Duncan Nevin - Technical Lead 
**Project:** 72 Hour Survival Challenge
**Task:** Create a commit message
**Committed location:** /Users/Duncan_Nevin/Documents/72-hours-survival

---

## Evaluation Criteria

| # | Criterion | Why it matters for this task |
|---|-----------|------------------------------|
| 1 | Commit messages start with the jira ticket number followed by a colon and a space | Ensures that each commit is tied directly to a Jira ticket |
| 2 | Commit main line messages are no longer than 50 characters | Ensures that the message is clearly visible in the source control |
| 3 | Additional details are always included in bullet points | Ensures that underlying details are provided for future technical decisions |

---

## Prompt Used

Use the provided Jira ticket number and diff to write a commit message. You will evaluate these diffs to find out what's changed. The message will follow these guidelines:

  1. Subject line starts with Jira ticket number, colon, space (e.g. TEST-1234: )
  2. Subject line ≤ 50 characters
  3. Body details in bullet points (no length limit)

---

## Output Comparison

### Model A: Claude
> TEST-1234: Fix spinner animation frames
>
>  - Keep walker emoji (🚶) in position 2 across frames 2-4 for smoother animation
>  - Correct frames 3-5 which had walker drifting too far right
>  - Add missing newline at end of file

### Model B: Epam Dial
> TEST-1234: Update spinner animation frames
>
>  - Modified SPINNER_FRAMES array to adjust the sequence and placement of the 🚶 emoji for improved animation flow
>  - Replaced previous single 🚶 frames with new frames featuring double 🚶 in some positions
>  - Ensured consistent animation pattern for better visual feedback

---

## Scorecard

| Criterion | Model A score (1–3) | Model A evidence | Model B score (1–3) | Model B evidence |
|-----------|---------------------|------------------|---------------------|------------------|
| Commit messages start with the jira ticket number followed by a colon and a space | 3 |  TEST-1234: | 3 | TEST-1234:  |
| Commit main line messages are no longer than 50 characters | 3 | TEST-1234: Fix spinner animation frames | 3 | TEST-1234: Update spinner animation frames |
| Additional details are always included in bullet points | 3 | (see output comparison Model A: Claude) | 2 | (see output comparison Model B: Epam Dial) |
| **Total** | 9 | | 8 | |

---

## Decision

**Selected model:** Claude

**Rationale:** It had the most accurate description as to what changed. Has the most concise bullet points. It didn't make an assumption about the reason for the change.

---

## Active Constraint

**What could change this decision within 30 days:**
Token budget cap reached

---

## Revision history

| Version | Date | Change |
|---------|------|--------|
| 1.0 | 2026-06-24 | Initial commit |
