# Cloudflare Workers deployment (no Containers required)

This deployment uses Cloudflare Workers Static Assets and does not use Cloudflare Containers.

Cloudflare dashboard settings:
- Root directory: `/cloudflare`
- Build command: `yarn build`
- Deploy command: `npx wrangler deploy`
- Version command: `npx wrangler versions upload`

This hosts a generated dashboard/catalog. It does not run shell commands, Claude Code, Codex, hooks, or a persistent agent runtime.
