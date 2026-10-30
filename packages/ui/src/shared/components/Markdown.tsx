import type { CSSProperties } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders markdown (GitHub flavoured). Raw HTML is not rendered and link URLs are sanitized by
 * react-markdown; links open in a new tab. `inverted` is for text on a primary-colored
 * background, such as the user's own chat messages. `breaks` keeps single line breaks, as typed
 * in a chat box. Wide tables scroll instead of overflowing.
 */
export function Markdown({
  text,
  className = "",
  style,
  inverted = false,
  breaks = false,
}: Readonly<{
  text: string;
  className?: string;
  style?: CSSProperties;
  inverted?: boolean;
  breaks?: boolean;
}>) {
  return (
    <div className={`kx-markdown ${inverted ? "kx-markdown-inverted" : ""} ${className}`} style={style}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, children, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          table: ({ node: _node, ...props }) => (
            <div className="kx-markdown-table">
              <table {...props} />
            </div>
          ),
        }}
      >
        {breaks ? hardBreaks(text) : text}
      </ReactMarkdown>
    </div>
  );
}

/** Turns single line breaks into markdown hard breaks, leaving fenced code blocks alone. */
function hardBreaks(text: string): string {
  return text
    .split(/(^```[\s\S]*?^```)/m)
    .map((part, index) => (index % 2 ? part : part.replace(/([^\n])\n(?=[^\n])/g, "$1  \n")))
    .join("");
}
