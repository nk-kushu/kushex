import type { Icon } from "@tabler/icons-react";
import {
  AgentRunIcon,
  ArtifactIcon,
  ContextIcon,
  MemoryIcon,
  DebugEventsIcon,
  ExecutorIcon,
  MindUnitIcon,
  ModelCallIcon,
  OperationIcon,
  ToolCallIcon,
  TurnIcon,
  WorkflowStepIcon,
} from "../../shared/lib/icons";
import type { SpanKind, Tone } from "./debugTrace";

/** Icon, accent text, soft chip and timeline bar colors per span kind. */
export const KIND_STYLES: Readonly<
  Record<SpanKind, Readonly<{ icon: Icon; text: string; chip: string; bar: string }>>
> = {
  root: {
    icon: DebugEventsIcon,
    text: "kx:text-text-muted",
    chip: "kx:bg-fill",
    bar: "kx:bg-text-muted",
  },
  run: {
    icon: AgentRunIcon,
    text: "kx:text-[#3178c6]",
    chip: "kx:bg-[#3178c6]/12",
    bar: "kx:bg-[#3178c6]",
  },
  step: {
    icon: WorkflowStepIcon,
    text: "kx:text-[#9b6cc4]",
    chip: "kx:bg-[#9b6cc4]/12",
    bar: "kx:bg-[#9b6cc4]",
  },
  executor: {
    icon: ExecutorIcon,
    text: "kx:text-[#cb8a00]",
    chip: "kx:bg-[#cb8a00]/12",
    bar: "kx:bg-[#cb8a00]",
  },
  mind: {
    icon: MindUnitIcon,
    text: "kx:text-[#2f9e5b]",
    chip: "kx:bg-[#2f9e5b]/12",
    bar: "kx:bg-[#2f9e5b]",
  },
  turn: { icon: TurnIcon, text: "kx:text-text-muted", chip: "kx:bg-fill", bar: "kx:bg-text-muted" },
  model: {
    icon: ModelCallIcon,
    text: "kx:text-[#4f8fc0]",
    chip: "kx:bg-[#4f8fc0]/12",
    bar: "kx:bg-[#4f8fc0]",
  },
  tool: {
    icon: ToolCallIcon,
    text: "kx:text-[#d9734f]",
    chip: "kx:bg-[#d9734f]/12",
    bar: "kx:bg-[#d9734f]",
  },
  context: {
    icon: ContextIcon,
    text: "kx:text-[#7c6fd6]",
    chip: "kx:bg-[#7c6fd6]/12",
    bar: "kx:bg-[#7c6fd6]",
  },
  memory: {
    icon: MemoryIcon,
    text: "kx:text-[#2f9e5b]",
    chip: "kx:bg-[#2f9e5b]/12",
    bar: "kx:bg-[#2f9e5b]",
  },
  artifact: {
    icon: ArtifactIcon,
    text: "kx:text-[#0f8f90]",
    chip: "kx:bg-[#0f8f90]/12",
    bar: "kx:bg-[#0f8f90]",
  },
  other: {
    icon: OperationIcon,
    text: "kx:text-text-muted",
    chip: "kx:bg-fill",
    bar: "kx:bg-text-muted",
  },
};

/** antd Tag colors per tone. */
export const TONE_TAGS: Readonly<Record<Tone, string | undefined>> = {
  default: undefined,
  primary: "processing",
  success: "success",
  warning: "warning",
  error: "error",
};

/** Dot colors per tone, for event lines. */
export const TONE_DOTS: Readonly<Record<Tone, string>> = {
  default: "kx:bg-border",
  primary: "kx:bg-primary",
  success: "kx:bg-success",
  warning: "kx:bg-warning",
  error: "kx:bg-error",
};
