import { Button, Typography } from "antd";
import { borderR, borderT, borderB } from "../../shared/lib/styles";
import { CodePlaceholder } from "./CodePlaceholder";

const before = ["export function example(input: string) {", "  return thing(input);", "}"];
const after = ["export function example(input: string) {", "  const value = thing(input);", "  return value?.trim() ?? null;", "}"];

export function DiffView({ title }: Readonly<{ title: string }>) {
  return (
    <div className="kx:flex kx:h-full kx:flex-col">
      <div className="kx:grid kx:min-h-0 kx:flex-1 kx:grid-cols-2">
        <section aria-label="Before" className={`kx:flex kx:min-h-0 kx:flex-col ${borderR}`}>
          <Typography.Text type="secondary" className={`kx:px-3 kx:py-1 kx:text-xs ${borderB}`}>
            before
          </Typography.Text>
          <CodePlaceholder lines={before} label={`${title} before`} />
        </section>
        <section aria-label="After" className="kx:flex kx:min-h-0 kx:flex-col">
          <Typography.Text type="secondary" className={`kx:px-3 kx:py-1 kx:text-xs ${borderB}`}>
            after
          </Typography.Text>
          <CodePlaceholder lines={after} label={`${title} after`} />
        </section>
      </div>
      <div className={`kx:flex kx:justify-end kx:gap-2 kx:bg-surface kx:p-2 ${borderT}`}>
        <Button>Reject</Button>
        <Button type="primary">Accept</Button>
      </div>
    </div>
  );
}
