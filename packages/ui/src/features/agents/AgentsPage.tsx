import { useNavigate, useParams } from "react-router";
import { useAppDispatch } from "../../app/hooks";
import { EmptyMain } from "../workbench/EmptyMain";
import { paths } from "../workbench/navigation";
import { Panes } from "../workbench/Panes";
import { mobileViewChanged } from "../workbench/workbenchSlice";
import { AgentEditor } from "./AgentEditor";
import { AgentsSide } from "./AgentsSide";

/** Agents as code: the list of agent files and the selected one in the editor. */
export function AgentsPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { agentName } = useParams();
  const open = (name: string) => {
    void navigate(paths.agents(name));
    dispatch(mobileViewChanged("main"));
  };
  return (
    <Panes
      side={<AgentsSide selected={agentName} onOpen={open} />}
      main={
        agentName ? (
          <AgentEditor key={agentName} name={agentName} />
        ) : (
          <EmptyMain text="Choose an agent or create a new one." />
        )
      }
    />
  );
}
