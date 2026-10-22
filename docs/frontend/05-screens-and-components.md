# 05 — Screens and components

## Shell

antd `Layout` with a collapsible `Sider` (antd `Menu`), a `Header` with scope
picker, connection status and color-mode switch, and a scrollable `Content`.

```
┌───────────────────────────────────────────────────────────────┐
│ Kushex   [project ▾] [workspace ▾]        ● connected  ☾  ⚙   │  Header
├──────────┬────────────────────────────────────────────────────┤
│ Runs     │                                                    │
│ Sessions │   <route content>                                  │
│ Artifacts│                                                    │
│ Usage    │                                                    │
│ Approvals│ (Badge with count of waiting-for-approval)         │
│ Debug    │                                                    │
│ Settings │                                                    │
└──────────┴────────────────────────────────────────────────────┘
```

The scope picker selects the `ExecutionScopeRef` (`projectId`, optional
`workspaceId`). It is stored in the URL and sent with every request. The server
still enforces scope; the picker only filters.

## Routes

| Path | Screen | Main antd components |
| --- | --- | --- |
| `/runs` | Runs list | `Table` (server-side sort/filter/pagination), `Segmented` status quick filters, `Input.Search`, `StatusTag` |
| `/runs/:runId` | Run detail | `PageHeader`-style header with `Descriptions`, action `Button`s, `Tabs` |
| `/runs/:runId?tab=steps` | Steps | `Steps` (workflow shape) + `Table` of step runs, expandable rows for attempts |
| `/runs/:runId?tab=timeline` | Timeline | `Timeline` of lifecycle transitions; custom Tailwind trace bars for durations |
| `/runs/:runId?tab=artifacts` | Run artifacts | `List` + `Drawer` viewer |
| `/runs/:runId?tab=usage` | Run usage | `Statistic` cards, `Progress` against budget |
| `/runs/:runId?tab=debug` | Debug events | virtual `Table`, level `Select`, channel filter, live toggle |
| `/sessions/:sessionId` | Agentic session | `Descriptions`, `Tree` of sub-agents, `Timeline` of actions/tool calls |
| `/artifacts` | Artifact browser | `Table` + search, `Drawer` with paged text viewer |
| `/usage` | Usage ledger | `Table` grouped by scope, `Statistic`, budget `Progress` |
| `/approvals` | Publication queue | `List` of change proposals, `Drawer` with review report + checks, approve/reject `Popconfirm` |
| `/settings` | Settings | `Form` (API URL in standalone, color mode, density) |

Pages are `React.lazy` loaded and wrapped in `Suspense` with an antd `Skeleton`.

## Run detail header

```
Run 01J…F3  [active]                       [Pause] [Stop] [⋯ Cancel]
workflow: google-login@3   started 12:04:31   duration 4m 12s
modelCalls 14 · tokens 38.2k in / 6.1k out · toolCalls 52 · fixes 1
```

- Built from antd `Descriptions` (size small) and `Typography.Text copyable`
  for ids.
- Available actions are computed from the lifecycle transition table
  (`workflowRunLifecycle`) for the current status, so the UI never offers a
  transition the engine would reject. The server remains authoritative.
- Stop/Cancel open a `Modal` asking for a reason; the confirm button shows a
  spinner until the receipt arrives.

## Shared components (`shared/components`)

| Component | Responsibility |
| --- | --- |
| `StatusTag` | `LifecycleStatus` → antd `Tag` with text and icon (see [03](03-styling-antd-tailwind.md) §6) |
| `CopyId` | Monospace shortened id with full id in `Tooltip`, copy on click |
| `DurationText` | Live-updating duration for non-terminal runs |
| `UsageMeter` | Tailwind bar + antd `Tooltip` showing used / reserved / limit |
| `JsonViewer` | Collapsible JSON for payloads (`DebugPayload`, task inputs/results); lazy-loaded |
| `ArtifactViewer` | Paged text/markdown/JSON viewer using the artifact page API; never loads a whole large artifact |
| `ErrorResult` | Maps API errors (404, 403, 409, 5xx) to antd `Result` with a retry action |
| `EmptyState` | antd `Empty` with a contextual hint |

## Icons

All app icons come from **Tabler Icons** (`@tabler/icons-react`), browse at
[tabler.io/icons](https://tabler.io/icons). `@ant-design/icons` stays installed
because antd depends on it, but we don't pick icons from it in our own code.

Icons go through one wrapper so size and color follow the antd theme:

```tsx
// shared/components/AppIcon.tsx
import type { Icon as TablerIcon } from "@tabler/icons-react";
import { useTheme } from "antd-style";

type AppIconProps = Readonly<{
  icon: TablerIcon;
  size?: "sm" | "md" | "lg";
  label?: string;          // set when the icon is the only content (icon-only button)
}>;

export function AppIcon({ icon: Icon, size = "md", label }: AppIconProps) {
  const token = useTheme();
  const px = { sm: token.fontSizeSM, md: token.fontSize, lg: token.fontSizeLG }[size];
  return (
    <span role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}
          className="anticon">   {/* antd aligns children with .anticon (prefixed: kx-icon) */}
      <Icon size={px + 2} stroke={1.75} />
    </span>
  );
}
```

```tsx
import { IconPlayerStop, IconRefresh } from "@tabler/icons-react";

<Button danger icon={<AppIcon icon={IconPlayerStop} />}>Stop</Button>
<Button type="text" icon={<AppIcon icon={IconRefresh} label="Refresh" />} />
```

Rules:

- Import icons by name (`import { IconX } from "@tabler/icons-react"`) so
  unused icons are tree-shaken. Never import the whole set or build an
  icon-by-string lookup over the full package.
- Keep icon meanings in one place, `shared/lib/icons.ts`
  (`export const RunIcon = IconRoute; export const ArtifactIcon = IconFileText; ...`),
  so the same concept always uses the same icon.
- Color comes from `currentColor` (the antd text/button color), not props.
- The `.anticon` class name follows `iconPrefixCls` ("kx-icon"); check the
  alignment once when wiring `AppIcon` and adjust the class to match.

Suggested status icons for `StatusTag`:

| Status | Tabler icon |
| --- | --- |
| `queued` / `created` | `IconClockHour4` |
| `active` | `IconLoader2` (spinning) |
| `retry-wait` | `IconRotateClockwise` |
| `waiting-for-approval` | `IconUserCheck` |
| `paused` | `IconPlayerPause` |
| `interrupted` | `IconPlugConnectedX` |
| `recovering` | `IconHeartbeat` |
| `stopping` / `stopped` | `IconPlayerStop` |
| `completed` | `IconCircleCheck` |
| `failed` | `IconCircleX` |
| `cancelled` | `IconBan` |

## Component guidelines

- Props are typed with readonly types; components don't fetch unless they are a
  page or a clearly named container (`RunStepsContainer`).
- Tables: define `columns` with `useMemo`, keep `rowKey` stable (`stepRunId`,
  `eventId`), enable `virtual` above ~200 rows.
- Use `App.useApp()` for `message`, `notification` and `modal` so they inherit
  the theme and prefix (static `message.success()` does not).
- Long ids, paths and tokens: `Typography.Text ellipsis` + Tailwind `min-w-0`.
- Times are shown in the viewer's timezone with the raw epoch ms in a tooltip.
