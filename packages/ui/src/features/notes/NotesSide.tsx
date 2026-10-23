import { Button, Input, Menu } from "antd";
import { useState } from "react";
import { AppIcon } from "../../shared/components/AppIcon";
import { AddIcon, PinIcon, SearchIcon } from "../../shared/lib/icons";
import { PaneHeader } from "../workbench/PaneHeader";

export const notes = [
  { key: "n1", title: "Note title", pinned: true },
  { key: "n2", title: "Another note", pinned: true },
  { key: "n3", title: "Note", pinned: false },
  { key: "n4", title: "Note", pinned: false },
];

export function NotesSide({ selected, onSelect }: Readonly<{ selected: string; onSelect: (key: string) => void }>) {
  const [query, setQuery] = useState("");
  return (
    <div className="kx:flex kx:h-full kx:flex-col kx:bg-surface">
      <PaneHeader title="Notes" extra={<Button type="text" size="small" icon={<AppIcon icon={AddIcon} label="New note" />} />} />
      <div className="kx:p-2">
        <Input
          aria-label="Search notes"
          size="small"
          placeholder="Search"
          prefix={<AppIcon icon={SearchIcon} size="sm" />}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <Menu
        mode="inline"
        className="kx:min-h-0 kx:flex-1 kx:overflow-auto"
        style={{ borderInlineEnd: "none" }}
        selectedKeys={[selected]}
        onClick={({ key }) => onSelect(key)}
        items={notes
          .filter((note) => note.title.toLowerCase().includes(query.toLowerCase()))
          .map((note) => ({ key: note.key, label: note.title, icon: note.pinned ? <AppIcon icon={PinIcon} size="sm" /> : <span className="kx:inline-block kx:w-4" /> }))}
      />
    </div>
  );
}
