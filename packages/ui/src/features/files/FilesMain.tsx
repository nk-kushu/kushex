import { Splitter } from "antd";
import { FillTabs } from "../../shared/components/FillTabs";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import { usePersistedSplitter } from "../settings/usePersistedSplitter";
import { EmptyMain } from "../workbench/EmptyMain";
import {
  fileTabActivated,
  fileTabClosed,
  selectActiveFileTab,
  selectFileTabs,
  selectProjectId,
} from "../workbench/workbenchSlice";
import { BottomPanel } from "./BottomPanel";
import { FileViewer } from "./FileViewer";
import { DiffView } from "./DiffView";

export function FilesMain() {
  const dispatch = useAppDispatch();
  const tabs = useAppSelector(selectFileTabs);
  const projectId = useAppSelector(selectProjectId);
  const active = useAppSelector(selectActiveFileTab);
  const { splitter, size } = usePersistedSplitter("files", 2);

  return (
    <Splitter orientation="vertical" {...splitter}>
      <Splitter.Panel size={size(0)} min={120}>
        {tabs.length === 0 ? (
          <EmptyMain text="Open a file from the tree" />
        ) : (
          <FillTabs
            type="editable-card"
            hideAdd
            size="small"
            activeKey={active ?? undefined}
            onChange={(key) => dispatch(fileTabActivated(key))}
            onEdit={(key, action) => {
              if (action === "remove" && typeof key === "string") dispatch(fileTabClosed(key));
            }}
            items={tabs.map((tab) => ({
              key: tab.key,
              label: tab.kind === "diff" ? `Δ ${tab.title}` : tab.title,
              children:
                tab.kind === "diff" ? (
                  <DiffView title={tab.title} />
                ) : projectId && tab.path ? (
                  <FileViewer projectId={projectId} path={tab.path} />
                ) : (
                  <EmptyMain text="Open a file from the tree" />
                ),
            }))}
          />
        )}
      </Splitter.Panel>
      <Splitter.Panel size={size(1)} defaultSize="28%" min={60} collapsible>
        <BottomPanel />
      </Splitter.Panel>
    </Splitter>
  );
}
