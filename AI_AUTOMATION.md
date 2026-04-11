# AI Automation Setup (Free)

This repository includes free AI workflows using Gemini API:

- PR review bot: `.github/workflows/ai-review.yml`
- AI maintainer bot: `.github/workflows/ai-maintainer.yml`

## 1. What you get

- Automatic AI review comments on each pull request.
- Automatic AI implementation from issue comments using `/ai ...`.
- Manual trigger from Actions tab for ad-hoc AI tasks.

## 2. Required secrets

Open repository settings:

- Settings -> Secrets and variables -> Actions -> New repository secret

Create this secret:

- `GEMINI_API_KEY`: your Google AI Studio API key (free tier available)

## 3. Recommended repository settings

- Actions permissions: Allow all actions and reusable workflows
- Workflow permissions: Read and write permissions
- Allow GitHub Actions to create and approve pull requests: enabled

## 4. How to use AI Maintainer

### Option 0: fully automatic from issue label

Add label `ai-task` to an issue.
The workflow will start automatically and try to open a PR.

### Option A: from issue comments

In any issue (not PR), write:

```text
/ai fix the bug in X and add tests
```

The workflow will:

1. Read your issue + command
2. Generate code changes using Gemini + Aider
3. Push a new branch
4. Open a pull request
5. Comment back on the issue with PR link

### Option B: manual run

Open Actions -> AI Maintainer (Gemini + Aider) -> Run workflow, then fill:

- `task`
- optional `issue_number`
- optional `base_branch`

## 5. How to use AI Review

Open or update a pull request.
The bot will post AI review feedback as a PR comment.

## 6. Important notes

- AI output is not guaranteed correct. Always review before merge.
- Keep tasks specific for better result quality.
- For big refactors, split into smaller issue tasks.
