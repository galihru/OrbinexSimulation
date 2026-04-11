# AI Automation (Ollama, No API Key)

This repository uses local-model AI automation in GitHub Actions via Ollama.
No cloud API key is required for the AI workflows.

## Workflows

- `.github/workflows/ai-review.yml`
  - Trigger: every non-draft pull request.
  - Action: posts an AI review comment on the PR.

- `.github/workflows/ai-maintainer.yml`
  - Trigger:
    - manual run via `workflow_dispatch`
    - issue comment starting with `/ai`
    - issue labeled `ai-task`
  - Action: runs Aider with Ollama, creates a branch, commits changes, and opens a PR.

## Model Configuration

Default model:
- `qwen2.5-coder:1.5b`

Fallback model if pull fails:
- `llama3.2:1b`

Optional override:
- Add repository variable `OLLAMA_MODEL` in GitHub Settings -> Secrets and variables -> Actions -> Variables.

Example values:
- `qwen2.5-coder:1.5b`
- `llama3.2:3b`

## How It Works in GitHub Actions

Each run does the following:
1. Installs Ollama.
2. Starts Ollama server.
3. Pulls the configured model.
4. Runs review or maintainer flow.

This is fully automatic, but first run can be slower because model download happens in CI.

## Usage

### PR Review
Open or update a non-draft PR. The workflow auto-comments with AI review feedback.

### Issue to PR Automation
On any issue, comment:

```text
/ai implement this issue with tests and update docs
```

or add label:

```text
ai-task
```

The maintainer workflow will generate changes and open a PR.

## Optional Performance Upgrade

For faster and more stable runs, use a self-hosted runner with Ollama pre-installed and model pre-pulled.
GitHub-hosted runners also work, but they re-download model layers more often.

## Safety Notes

- AI-generated code still needs human review before merge.
- Keep branch protection and required review checks enabled.
- Avoid giving overly broad `/ai` tasks; precise tasks produce better results.
