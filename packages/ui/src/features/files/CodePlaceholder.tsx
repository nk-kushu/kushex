/** Stand-in for the code editor: line numbers and placeholder lines. */
const sample = [
  "import { thing } from \"./other\";",
  "",
  "export function example(input: string) {",
  "  const value = thing(input);",
  "  if (!value) {",
  "    return null;",
  "  }",
  "  return value.trim();",
  "}",
  "",
];

export function CodePlaceholder({ lines = sample, label }: Readonly<{ lines?: readonly string[]; label: string }>) {
  return (
    <div role="region" aria-label={label} className="kx:h-full kx:overflow-auto kx:bg-surface kx:py-2 kx:font-mono kx:text-sm kx:leading-6">
      {lines.map((line, index) => (
        <div key={index} className="kx:flex">
          <span className="kx:w-12 kx:shrink-0 kx:pr-4 kx:text-right kx:text-text-muted kx:select-none">{index + 1}</span>
          <span className="kx:whitespace-pre kx:text-text">{line}</span>
        </div>
      ))}
    </div>
  );
}
