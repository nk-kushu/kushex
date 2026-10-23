import { Input, Splitter, Typography } from "antd";
import { FillTabs } from "../../shared/components/FillTabs";
import { useState } from "react";
import { borderB } from "../../shared/lib/styles";

const initial = "# Note title\n\nA short paragraph of text.\n\n- point one\n- point two\n";

/** Edit and preview side by side. The preview is plain text until a markdown renderer is chosen. */
export function NotesMain({ title }: Readonly<{ title: string }>) {
  const [text, setText] = useState(initial);
  return (
    <FillTabs
      type="card"
      size="small"
      items={[
        {
          key: "note",
          label: title,
          children: (
            <Splitter>
              <Splitter.Panel min={160}>
                <div className="kx:flex kx:h-full kx:flex-col kx:bg-surface">
                  <Typography.Text type="secondary" className={`kx:px-3 kx:py-1 kx:text-xs ${borderB}`}>
                    edit
                  </Typography.Text>
                  <Input.TextArea
                    aria-label="Note text"
                    variant="borderless"
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    className="kx:flex-1 kx:font-mono"
                    style={{ resize: "none" }}
                  />
                </div>
              </Splitter.Panel>
              <Splitter.Panel min={160}>
                <div className="kx:flex kx:h-full kx:flex-col kx:bg-surface">
                  <Typography.Text type="secondary" className={`kx:px-3 kx:py-1 kx:text-xs ${borderB}`}>
                    preview
                  </Typography.Text>
                  <div className="kx:flex-1 kx:overflow-auto kx:p-3 kx:whitespace-pre-wrap">{text}</div>
                </div>
              </Splitter.Panel>
            </Splitter>
          ),
        },
      ]}
    />
  );
}
