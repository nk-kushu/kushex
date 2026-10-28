import { useNavigate, useParams } from "react-router";
import { useAppDispatch } from "../../app/hooks";
import { paths } from "../workbench/navigation";
import { Panes } from "../workbench/Panes";
import { mobileViewChanged } from "../workbench/workbenchSlice";
import { AgentEditor } from "./AgentEditor";
import { AgentsHome } from "./AgentsHome";

/**
 * Agents as code. Without an agent open it lists them; with one open the editor takes the
 * page, and its explorer switches between agents.
 */
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
      main={
        agentName ? <AgentEditor key={agentName} name={agentName} /> : <AgentsHome onOpen={open} />
      }
    />
  );
}
