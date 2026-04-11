# Contributing to OrbinexSimulation

Thank you for your interest in contributing.

## Getting Started

1. Fork and clone the repository.
2. Install dependencies:

```bash
npm ci
npm -C orbinexsim-npm ci
```

3. Start local development:

```bash
npm run dev
```

## Development Scope

- Main web app source is in `src/`.
- npm wrapper package source is in `orbinexsim-npm/src/`.
- Documentation updates should be clear, reproducible, and technically accurate.

## Commit and Pull Request Guidelines

- Use clear commit messages (Conventional Commits preferred), for example:
  - `feat: add AR marker filter`
  - `fix: prevent invalid orbit sample radius`
  - `docs: update publish runbook`
- Keep pull requests focused and small when possible.
- Include a short description of what changed and why.
- Link related issues (for example: `Closes #123`).
- Add screenshots for UI/UX changes.
- Update docs if behavior or API changed.

## Quality Checks

Before opening a pull request, run:

```bash
npm run build
npm -C orbinexsim-npm run build
```

If you touch TypeScript package code, also run:

```bash
npm -C orbinexsim-npm run lint
```

## Reporting Bugs

Use the bug report issue template and include:

- Reproduction steps
- Expected vs actual behavior
- Environment details (OS, browser, Node.js version)
- Logs and screenshots if available

## Code of Conduct

By participating, you are expected to uphold this project's
Code of Conduct in `CODE_OF_CONDUCT.md`.
