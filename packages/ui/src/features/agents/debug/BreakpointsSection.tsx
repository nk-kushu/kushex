import { Button, Tooltip, Typography } from "antd";
import type { DebugBreakpointDto } from "@kushex/contracts";
import { useAppDispatch, useAppSelector } from "../../../app/hooks";
import { AppIcon } from "../../../shared/components/AppIcon";
import { RemoveIcon } from "../../../shared/lib/icons";
import {
  breakpointsCleared,
  breakpointToggled,
  selectAgentBreakpoints,
} from "../../runs/runsSlice";
import { DebugSection } from "./DebugSection";

/**
 * Every breakpoint of the agent, by file, with the code on its line, like VS Code's
 * Breakpoints view. During a debug session it shows where each one bound.
 */
export function BreakpointsSection({
  agentName,
  contentOf,
  bound,
  onOpen,
}: Readonly<{
  agentName: string;
  /** The file's current text, for the line previews. */
  contentOf: (file: string) => string | undefined;
  /** Where the running debug session bound them; empty without one. */
  bound: readonly DebugBreakpointDto[];
  onOpen: (file: string, line: number) => void;
}>) {
  const dispatch = useAppDispatch();
  const breakpoints = useAppSelector((state) => selectAgentBreakpoints(state, agentName));
  const files = Object.entries(breakpoints).sort(([a], [b]) => a.localeCompare(b));
  const count = files.reduce((total, [, lines]) => total + lines.length, 0);

  return (
    <DebugSection
      label="Breakpoints"
      title={`Breakpoints${count ? ` (${count})` : ""}`}
      actions={
        count > 0 && (
          <Tooltip title="Remove all breakpoints">
            <Button
              type="text"
              size="small"
              onClick={() => dispatch(breakpointsCleared(agentName))}
              icon={<AppIcon icon={RemoveIcon} size="sm" label="Remove all breakpoints" />}
            />
          </Tooltip>
        )
      }
    >
      {count === 0 ? (
        <Typography.Text type="secondary" className="kx:block kx:px-3 kx:py-1 kx:text-xs">
          Click left of a line number in the editor to add one.
        </Typography.Text>
      ) : (
        files.map(([file, lines]) => {
          const text = contentOf(file)?.split("\n");
          return (
            <div key={file}>
              <div className="kx:truncate kx:px-3 kx:pt-1 kx:text-xs kx:font-medium kx:text-text">
                {file}
              </div>
              <ul aria-label={`Breakpoints in ${file}`} className="kx:m-0 kx:list-none kx:p-0">
                {lines.map((line) => {
                  const state = bound.find(
                    (entry) => entry.file === file && entry.requestedLine === line,
                  );
                  const moved = state?.verified && state.line !== line;
                  return (
                    <li
                      key={line}
                      className="kx:group kx:flex kx:items-center kx:gap-1.5 kx:pr-1 kx:pl-4 kx:hover:bg-fill"
                    >
                      <span
                        aria-hidden
                        title={
                          state && !state.verified
                            ? "Not bound: no code on or after this line"
                            : undefined
                        }
                        className={`kx:inline-block kx:size-2 kx:shrink-0 kx:rounded-full ${
                          state && !state.verified
                            ? "kx:border kx:border-solid kx:border-[#848484]"
                            : "kx:bg-[#e51400]"
                        }`}
                      />
                      <button
                        type="button"
                        aria-label={`${file}:${line}`}
                        onClick={() => onOpen(file, state?.line ?? line)}
                        className="kx:flex kx:min-w-0 kx:flex-1 kx:cursor-pointer kx:items-baseline kx:gap-2 kx:border-0 kx:bg-transparent kx:py-0.5 kx:text-left"
                      >
                        <span className="kx:min-w-0 kx:flex-1 kx:truncate kx:font-mono kx:text-xs kx:text-text">
                          {text?.[line - 1]?.trim() || " "}
                        </span>
                        <span className="kx:shrink-0 kx:font-mono kx:text-xs kx:text-text-muted">
                          {line}
                          {moved ? ` → ${state.line}` : ""}
                        </span>
                      </button>
                      <Button
                        type="text"
                        size="small"
                        className="kx:opacity-0 kx:group-hover:opacity-100 kx:focus:opacity-100"
                        onClick={() => dispatch(breakpointToggled({ agentName, file, line }))}
                        icon={
                          <AppIcon
                            icon={RemoveIcon}
                            size="sm"
                            label={`Remove breakpoint ${file}:${line}`}
                          />
                        }
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })
      )}
    </DebugSection>
  );
}
