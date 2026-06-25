# Prompt Template: Commit

**Date:** 2026-06-25
**Author:** Duncan Nevin - Technical Lead
**Project:** 72 Hour survival Challenge
**Model:** Use ./model-selection.md
**DIAL location:** [DIAL shared link or folder path]
**Committed location:** /Users/Duncan_Nevin/Documents/72-hours-survival
**Github:** https://github.com/duncannevin/72-hours-survival

---

## Purpose

Generate a well-structured git commit message from a Jira ticket number and `git diff` output. Use this template at any commit point to produce a consistently formatted message: a subject line prefixed with the ticket number (≤ 50 chars), followed by a bulleted body that summarises what changed and why. The goal is to keep commit history readable and traceable back to tickets without requiring the author to draft the message manually.

---

## Variable Placeholders

| Placeholder | Description | Example value |
|---|---|---|
| `{{status}}` | The status of the ticket | On branch feature/TEST-1234_kata_2 |
| `{{ticket_number}}` | This is the ticket that the work is being done. ie. Jira ticket | TEST-1234 |
| `{{diff}}` | This is the git diff output | diff --git a/ai/commit-message.md b/ai/commit-message.md |

---

## Output Format Instruction

The output should be the exact commit message that was created. e.g.

> TEST-1234: Fix spinner animation frames
>
>  - Keep walker emoji (🚶) in position 2 across frames 2-4 for smoother animation
>  - Correct frames 3-5 which had walker drifting too far right
>  - Add missing newline at end of file

---

## Prompt Body

Step 1:
List the files changed based on {{status}} and ask the user to select the files they want added. Once they have made there selection add them.

Step 2:
Create a commit message that starts with "{{ticket_number}}: " that is based on {{diff}}. You will evaluate these diffs to find out what's changed. The message will follow these guidelines:

  1. Subject line starts with Jira ticket number, colon, space (e.g. TEST-1234: )
  2. Subject line ≤ 50 characters
  3. Body details in bullet points (no length limit)

Step3:
Ask the user if they would like to push the change to the current branch.

---

## Test Run (Author)

**Input values used:**
- `{{ticket_number}}` = [value you used]
- `{{diff}}` = [value you used]

**Output quality:** [One sentence — was the output usable as-is, or did you revise?]

---

## Peer Review

**Reviewer:** [Name — Role]
**Date reviewed:** YYYY-MM-DD
**Model used by reviewer:** [Model name]

**Reviewer input values used:**
- `{{placeholder_1}}` = [value reviewer used]
- `{{placeholder_2}}` = [value reviewer used]

| Review question | Reviewer answer |
|---|---|
| Could you run the template without asking the author anything? | Yes / No — [one sentence] |
| Was the output format what you expected? | Yes / No — [one sentence] |
| Would you use this template on your own work? | Yes / No — [one sentence] |
| One concrete improvement suggestion | [One sentence] |

---

## Revision History

| Version | Date | Change | Author |
|---|---|---|---|
| 1.0 | YYYY-MM-DD | Initial commit | [Name] |
| 1.1 | YYYY-MM-DD | Post-review update | [Name] |