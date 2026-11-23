# FleetPolicy Copilot: frontend

Next.js 16 (App Router) · strict TypeScript · Tailwind CSS v4 · shadcn/ui · lucide icons · SWR.

The usual way to run it is `make dev` from the repository root, which starts the API and the web app together. To run only the web app:

```bash
pnpm install
NEXT_PUBLIC_API_URL=http://localhost:8001 pnpm dev
```

| Path | What lives there |
|---|---|
| `src/app/` | Routes: queue `/`, review `/requests/[id]`, `/policies/[clientId]`, `/insights`, `/how-it-works` |
| `src/features/` | Feature modules: queue, review workspace, policy viewer, insights charts |
| `src/lib/api.ts` | Typed API client, including the SSE parser for live analysis progress |
| `src/components/ui/` | shadcn/ui primitives |

See the root [README](../README.md) for the full project overview.
