import type { NoteSummaryDto } from "@kushex/contracts";
import { Alert, Button, Empty, Input, Menu, Spin, Tooltip } from "antd";
import { AppIcon } from "../../shared/components/AppIcon";
import { AddIcon, PinIcon, SearchIcon } from "../../shared/lib/icons";
import { PaneHeader } from "../workbench/PaneHeader";

type Props = Readonly<{
  notes: readonly NoteSummaryDto[] | undefined;
  error: string | null;
  selected: string | undefined;
  query: string;
  creating: boolean;
  onQuery: (query: string) => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
}>;

/** Pinned notes first, then the most recently edited; search matches titles and text. */
export function NotesSide({
  notes,
  error,
  selected,
  query,
  creating,
  onQuery,
  onSelect,
  onCreate,
}: Props) {
  return (
    <div className="kx:flex kx:h-full kx:flex-col kx:bg-surface">
      <PaneHeader
        title="Notes"
        extra={
          <Tooltip title="New note">
            <Button
              type="text"
              size="small"
              loading={creating}
              onClick={onCreate}
              icon={<AppIcon icon={AddIcon} label="New note" />}
            />
          </Tooltip>
        }
      />
      <div className="kx:p-2">
        <Input
          aria-label="Search notes"
          size="small"
          placeholder="Search"
          allowClear
          prefix={<AppIcon icon={SearchIcon} size="sm" />}
          value={query}
          onChange={(event) => onQuery(event.target.value)}
        />
      </div>
      {error && <Alert className="kx:mx-2" type="error" showIcon message={error} />}
      {!notes && !error && <Spin className="kx:mt-4" />}
      {notes?.length === 0 && (
        <Empty
          className="kx:mt-6"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={query ? "No matching notes" : "No notes yet"}
        />
      )}
      {notes && notes.length > 0 && (
        <Menu
          mode="inline"
          aria-label="Notes"
          className="kx:min-h-0 kx:flex-1 kx:overflow-auto"
          style={{ borderInlineEnd: "none" }}
          selectedKeys={selected ? [selected] : []}
          onClick={({ key }) => onSelect(key)}
          items={notes.map((note) => ({
            key: note.id,
            label: note.title,
            title: `${note.title} · edited ${new Date(note.updatedAt).toLocaleString()}`,
            icon: note.pinned ? (
              <AppIcon icon={PinIcon} size="sm" label="Pinned" />
            ) : (
              <span className="kx:inline-block kx:w-4" />
            ),
          }))}
        />
      )}
    </div>
  );
}
