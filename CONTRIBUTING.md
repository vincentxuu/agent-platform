# Contributing to Agent Platform

Thank you for your interest in contributing! This document outlines the process and guidelines for contributing to Agent Platform.

## Getting Started

1. **Fork the repository** and clone your fork
2. **Install dependencies**: `pnpm install`
3. **Start development**: `npm run dev` (runs at http://127.0.0.1:8787)
4. **Run checks**: `npm run check` before submitting PR

## Development Workflow

### Branching
- Create feature branches from `main`: `git checkout -b feat/your-feature`
- Use conventional prefixes: `feat/`, `fix/`, `docs/`, `refactor/`, `test/`, `chore/`

### Commits
- Follow [Conventional Commits](https://www.conventionalcommits.org/):
  - `feat: add new flow editor component`
  - `fix: resolve checkpoint resume race condition`
  - `docs: update provider configuration guide`
- Keep commits atomic and focused

### Testing
```bash
# Type checking
npm run check:types

# Runtime logic tests
npm run check:runtime

# Web UI smoke tests (Playwright)
npm run check:web-ui

# Local API smoke tests
npm run check:local-api

# Full check suite (runs in CI)
npm run check
```

### Code Style
- TypeScript with `strict: true`
- ESLint + Prettier (run `pnpm exec eslint . --fix`)
- Follow existing patterns in the codebase
- No `any` types without justification

## Pull Request Process

1. **Open a draft PR** early for discussion
2. **Ensure all checks pass** (`npm run check`)
3. **Update documentation** if behavior changes
4. **Add tests** for new functionality
5. **Request review** from maintainers
6. **Address feedback** and push updates
7. **Squash and merge** when approved

## Spec-Driven Development

Agent Platform uses [OpenSpec](https://github.com/agent-platform/openspec) for spec-driven development:

- Major changes start with `openspec-new-change`
- Specs live in `openspec/specs/`
- Changes tracked in `openspec/changes/`
- Run `openspec-verify-change` before merging

## Reporting Issues

- Use GitHub Issues with the appropriate template
- Include: steps to reproduce, expected vs actual behavior, environment info
- For security issues, see [SECURITY.md](SECURITY.md)

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold this code.

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).