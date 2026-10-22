# AGENTS.md

Guidelines for coding agents working on the CompressO codebase.

## Build/Lint/Test Commands

```bash
# Frontend
pnpm vite:dev          # Dev server on port 3001
pnpm vite:build        # Build frontend
pnpm tsc:check         # Type check TypeScript

# Tauri App
pnpm tauri:dev         # Run Tauri dev mode
pnpm tauri:build       # Build production app

# Code Quality
biome check .          # Lint and format check
biome check --write .  # Auto-fix issues

# Rust Backend
cd src-tauri && cargo build    # Build Rust code
cd src-tauri && cargo clippy    # Rust linter
```

Pre-commit: Husky runs `lint-staged` with Biome auto-format.

## Code Style Guidelines

### TypeScript/React

**Imports**: Node modules → @/* paths → relative. Biome auto-organizes on save. Use `@/*` for src/ alias.

**Formatting** (Biome): 2 spaces, 80 char width, single quotes (strings), double quotes (JSX), trailing commas, no console.log unless `// biome-ignore`.

**Components**: Directory structure with `index.tsx`, forwardRef, displayName. Destructure props and spread rest.

```typescript
const Button = React.forwardRef(
  (props: ButtonProps, ref) => {
    const { color, variant, ...rest } = props
    return <NextButton ref={ref} {...rest} />
  },
)
Button.displayName = 'Button'
```

**Styling**: Tailwind CSS with `cn()` utility for className merging. Dark mode with `dark:` prefix.

**UI Design System**: Reuse the existing HeroUI wrappers in `src/components/` (including Spinner and Button) and `UIProvider`. Do not recreate existing controls or add custom CSS spinners.

**State Management**: Valtio - `proxy()` for state, `useSnapshot()` for reading, direct mutation for writes.

**Routing**: TanStack Router with `createFileRoute()`, export `Route` constant from `src/routes/`.

**Types**: Define in `src/types/`. Use `export type` for types, `export const` with `as const` for constants.

**Error Handling**: try/catch for async, toast from sonner (position="bottom-center", richColors, 2500ms).

**Hooks**: Start with "use", export types, define in `src/hooks/`.

**Tauri**: Commands in `src/tauri/commands/`, use `core.invoke()`. snake_case in Rust, camelCase in TypeScript.

### Rust Backend

**Naming**: snake_case for functions/variables, PascalCase for types, SCREAMING_SNAKE_CASE for constants, snake_case files.

**Error Handling**: Return `Result<T, String>`, use String for errors.

**Structure**: `src-tauri/src/main.rs` (entry), `src-tauri/src/lib/` (modules: domain.rs, ffmpeg.rs, fs.rs, tauri_commands/, sys/).

## Project Configuration

**Biome**: Config in `biome.jsonc`, linter with custom rules, 80 char line width, auto-organize imports.

**TypeScript**: Strict mode, `@/*` → `./src/*` alias, ES5 target, ESNext module, JSX preserve.

**Rust**: Edition 2021, tauri 2.0, tokio, serde.

**Git**: Pre-commit runs lint-staged, Husky for hooks, ignore node_modules, dist.

## File Organization

```
src/
├── components/     # UI components (Button, Icon, etc.)
├── constants/      # Constants and config
├── hooks/          # Custom React hooks
├── providers/      # Context providers
├── routes/         # TanStack Router routes
├── tauri/          # Tauri command wrappers
├── types/          # TypeScript types
└── utils/          # Utilities (cn, string, fs)

src-tauri/src/
├── lib/            # Library modules (domain, ffmpeg, fs, tauri_commands)
└── main.rs         # Entry point
```

## Notes

- No test framework configured (no test scripts in package.json)
- Offline app (no network requests)
- FFmpeg sidecars bundled for cross-platform compression
- Use `pnpm` as package manager
- Follow existing patterns when adding features
