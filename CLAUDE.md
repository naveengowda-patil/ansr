# CLAUDE.md — Rules

## Source of truth
- `docs/BLUEPRINT.md` is the single source of truth for what to build: requirements, architecture, API contract, config and test coverage.
- Every change starts in the blueprint. Update it first, then write the code to match.
- If code and blueprint disagree, stop and raise it. Don't quietly fix either one.
- If a requirement is unclear, ask me, record the answer in the blueprint, then build.
- Never add or change endpoints, screens, dependencies or the API contract unless the blueprint says so, or I approve and the blueprint is updated in the same change.
- Keep `DECISIONS.md` current with assumptions and trade-offs.
- Keep `docs/PROMPT_LOG.md` current with my prompts that significantly shaped the development or led to a major decision (the prompt, summarised, and the decision it led to).
- Keep `AI_USAGE.md` current with mistakes I correct (what was wrong, how it was caught). Smaller corrections go under "Other corrections" in `docs/PROMPT_LOG.md`.

## Design principles
- Respect the boundaries defined in the blueprint. Layers talk only through the interfaces or protocols it defines, and no layer skips another.
- Inject dependencies through constructors or initializers. No singletons, service locators or global mutable state.
- Concrete implementations are created only in the composition root named in the blueprint.
- Business rules go in pure, testable functions, not in routes, views or adapters.
- The client only ever talks to our own backend, never to third-party services directly.
- Config is read in one place only. Never hardcode URLs, email addresses, IDs or timeouts.

## Code quality
- Strict typing everywhere: no `any` in TypeScript and no force unwraps in Swift.
- Small, single-purpose modules. Follow the existing patterns and naming in the repo.
- Use async/await. No unhandled promises or errors.
- No third-party dependencies unless the blueprint lists them with a reason.

## Security
- Validate every input at the boundary and reject unknown fields.
- Reject CR/LF in any user value that ends up in an email header. Never put user input into HTML.
- Errors use the single format defined in the blueprint. Never leak stack traces, internal hostnames or upstream error details.
- Never commit secrets or `.env` files. New config goes into `.env.example` with a safe default.
- No paid services, and nothing a reviewer would need an account for.

## UI
- No hardcoded colors, fonts or spacing; use the theme tokens.
- Every screen that loads data handles loading, loaded, empty and error (with retry).

## Testing
- Every behaviour change comes with a test.
- Tests never hit the real network; use injected mocks and recorded fixtures.
- Test behaviour through public interfaces, not internal details.
- A test must be able to fail. Check that it does when the behaviour breaks.
- Run the relevant tests before calling a task done, and report failures honestly.

## Git and process
- Never commit directly to `main`.
- Follow the branch and PR flow in the blueprint. The final PR into `main` stays open.
- Small, focused commits with descriptive messages. Never commit OS or editor files (`.DS_Store` etc).
- Don't push, open PRs or merge without my go-ahead.
- When you finish a task, summarise what changed, which blueprint section it follows, and which tests ran.
