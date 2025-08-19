# Repository Guidelines

## Project Structure & Module Organization
- Source lives in `src/` (JavaScript, HTML templates, CSS).
- Static assets in `public/` (images, icons, fonts). Place user-upload defaults in `public/assets/`.
- Tests in `tests/` (unit: `*.spec.js`, integration: `*.int.js`).
- Minimal current tree:
  - `README.md` — project goal and scope.
  - Create `index.html` in root or `public/` when starting UI.

## Build, Test, and Development Commands
- Run locally: `python3 -m http.server 5173` from project root (serves static files for quick dev).
- Alternative serve: `npx serve public` (if Node is available).
- No build step yet. If a bundler is added later, prefer `npm run dev` and `npm run build` scripts.

## Coding Style & Naming Conventions
- Indentation: 2 spaces; UTF‑8; LF line endings.
- JavaScript: ES modules, `const`/`let`, strict mode by default. Functions camelCase; components/objects PascalCase when exported.
- Files: `kebab-case.html/css`, `camelCase.js`. Keep modules under `src/` with focused responsibility.
- CSS: prefer BEM‑like class names (`.tool-bar__button--active`). Avoid inline styles.
- Lint/format (optional but recommended): ESLint + Prettier with default rules.

## Testing Guidelines
- Framework: lightweight setup recommended (Vitest or Jest). Place tests mirroring `src/` paths in `tests/`.
- Naming: unit tests `*.spec.js`; integration `*.int.js`.
- Run: `node --test` for native tests or `npx vitest` if configured.
- Aim for coverage of core tools: canvas operations, undo/redo stack, touch/gesture handling.

## Commit & Pull Request Guidelines
- Branch naming: `feat/`, `fix/`, `chore/`, `docs/` + short scope (e.g., `feat/canvas-resize`).
- Commits: Conventional Commits (e.g., `feat(canvas): add 1024x1536 preset`). Keep messages imperative and scoped.
- PRs: include summary, screenshots/GIFs of UI, steps to test, and any performance or touch-device notes.

## Security & Configuration Tips
- Never commit large binaries; store example images in `public/assets/` and git‑ignore bulky datasets.
- Validate image types client‑side; guard canvas size to prevent memory issues.
- Keep third‑party script use minimal; pin versions in `package.json` if added.
