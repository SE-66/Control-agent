# Cloudflare Workers deployment (no Containers required)

This deployment uses Cloudflare Workers Static Assets and does not use Cloudflare Containers.

Cloudflare dashboard settings:
- Root directory: `/cloudflare`
- Build command: leave empty
- Deploy command: `npx wrangler deploy`
- Version command: `npx wrangler versions upload`

This hosts a browser-accessible Control Agent web surface on the Workers free tier.

Important limitation: this static deployment does not run Claude Code, Codex, shell commands, hooks, or a persistent agent runtime on the server. Those capabilities require a container/VM or a larger Workers-native rewrite.
<!-- deployment trigger: 2026-10-01 -->
