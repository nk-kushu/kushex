import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders a note's markdown (GitHub flavoured). Raw HTML is not rendered and link URLs are
 * sanitized by react-markdown; links open in a new tab.
 */
export function Markdown({ text, className = "" }: Readonly<{ text: string; className?: string }>) {
  return (
    <div className={`kx-markdown ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, children, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
