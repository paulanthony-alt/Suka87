# Working on Suka 87 (keep sessions cheap)

- Keep command output short: pipe through `tail`/`head`, use `-q` flags, avoid dumping whole files.
- Read only the part of a file you need (grep for the function first).
- Don't take or read screenshots unless the user asks for a preview; verify with `npx tsc --noEmit` and `npx vite build` instead.
- Skip long headless-browser test runs unless a change touches gameplay logic.
- Checks: `npx tsc --noEmit`, `npm run validate:levels` (after map edits), `npx vite build`.
- Deploy: pushing to `main` publishes to GitHub Pages automatically.
