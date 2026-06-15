# Contributing to Trackit

Thank you for being part of this project. This guide covers everything you need to know to contribute cleanly without breaking things for anyone else.

Read this **before** you write a single line of code.

---

## Ground Rules

- Never push directly to `main` or `development`. Everything goes through a Pull Request.
- Never merge your own PR. Open it, request a review, and wait.
- Keep your branch focused on one thing. Don't fix a bug and add a feature in the same branch.
- If you're unsure about something, open an Issue or ask before writing code.

---

## Setting Up Locally

Follow the instructions in [README.md](README.md#local-setup) to get the project running on your machine.

---

## Branch Naming

| Type | Pattern | Example |
|---|---|---|
| New feature / page | `feature/description` | `feature/login-validation` |
| Bug fix | `fix/description` | `fix/sort-not-working` |
| Documentation | `docs/description` | `docs/add-setup-guide` |
| UI / styling only | `style/description` | `style/navbar-mobile-fix` |

Keep branch names lowercase, use hyphens, no spaces.

---

## Commit Messages

Use this format:

```
type: short description (present tense, no full stop)
```

| Type | When to use |
|---|---|
| `feat` | Adding a new feature or page |
| `fix` | Fixing a bug |
| `style` | CSS or visual changes only (no logic change) |
| `docs` | README, comments, documentation |
| `refactor` | Restructuring code without changing behaviour |
| `chore` | Anything else (renaming files, etc.) |

**Good examples:**
```
feat: add CSV export to find-patient page
fix: phone regex now accepts 070 prefix
style: reduce navbar height on mobile
docs: document all JS functions in find-patient
```

**Bad examples:**
```
update stuff
fixed bug
changes
```

---

## Pull Request Process

1. Make sure your branch is up to date with `development` before opening a PR:

```bash
git checkout development
git pull origin development
git checkout your-branch-name
git merge development
```

2. Push your branch and open a PR on GitHub.

3. Set the **base branch to `development`** — never target `main` directly.

4. Fill out every section of the PR template. Incomplete PRs will not be reviewed.

5. Add the appropriate label(s) from the list below.

6. Request a review from the project maintainer.

7. Address any review comments by pushing new commits to the same branch — do not close and reopen the PR.

8. Once approved, the maintainer will merge it.

---

## Labels

Apply at least one label to every PR and Issue you open.

| Label | Use for |
|---|---|
| `bug` | Something is broken or not working as expected |
| `feature` | A new page, function, or capability |
| `enhancement` | Improving something that already works |
| `ui` | Visual or CSS-only changes |
| `javascript` | Changes to JS logic |
| `documentation` | README, comments, guides |
| `needs review` | Ready for the maintainer to look at |
| `wip` | Still in progress — not ready for review |
| `good first issue` | A simple task suitable for beginners |

---

## Code Style

This project is vanilla HTML, CSS, and JavaScript — no transpilers or linters. Follow these conventions anyway:

**HTML**
- Use semantic elements (`<nav>`, `<main>`, `<section>`, `<form>`) where appropriate.
- Always include `id` and `name` attributes on form inputs.
- Keep indentation consistent (2 spaces).

**CSS**
- Use the CSS custom properties defined in `styles.css` — do not hardcode colour values.
- Add page-specific styles in a `<style>` block at the top of the HTML file, or add them to `styles.css` under a clearly labelled section.
- Comment any non-obvious rule.

**JavaScript**
- Use `const` and `let` — never `var`.
- Use `addEventListener` — never inline `onclick=""` in HTML.
- Comment every function with a one-line description of what it does.
- Wrap all page logic in `document.addEventListener('DOMContentLoaded', ...)`.

---

## Questions

Open a GitHub Issue with the `question` label, or message the maintainer directly.
