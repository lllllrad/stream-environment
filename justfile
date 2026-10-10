# Use the built-in Windows shell; Unix platforms keep just's default sh.
set windows-shell := ["cmd.exe", "/D", "/C"]

# List the available daily commands.
default:
    @just --list

# Install the exact dependencies recorded in the lockfile.
install:
    pnpm install --frozen-lockfile

# Build the browser bundles.
build:
    pnpm build

# Start the server using the existing browser build.
start:
    pnpm start

# Build the browser bundles and start the server.
run: build start

# Build once, then watch server changes (rebuild after frontend edits).
dev:
    pnpm dev

# Check TypeScript types.
typecheck:
    pnpm typecheck

# Run Node tests; optional arguments are forwarded to pnpm.
test *args="":
    pnpm test {{ args }}

# Run isolated Edge browser tests; pass Playwright options if needed.
e2e *args="":
    pnpm test:e2e {{ args }}

# Run type checking, Node tests, and the browser build, stopping on failure.
check: typecheck test build

# Run all checks, including isolated browser tests.
verify: check e2e

# Regenerate the English OpenAPI and response schemas.
contracts:
    pnpm contracts

# Create or exercise a demo on the running server (for example, --exercise).
demo *args="":
    pnpm demo {{ args }}

# Back up the database to a new timestamped file in .data/backups.
backup:
    pnpm backup

# Back up to a specific new file; quote paths containing spaces when invoking just.
backup-to destination:
    pnpm backup "{{ destination }}"

# Run an isolated soak test (30-second smoke by default; 28800 for eight hours).
soak seconds="30":
    pnpm soak --seconds "{{ seconds }}"

# Launch the local MCP adapter interactively; MCP hosts should launch Node directly.
mcp:
    pnpm mcp
