import panelCss from "@kushex/ui/style.css?inline";
import preflightCss from "@kushex/ui/preflight.css?inline";

const PROPERTY_RULE = /@property\s+[\w-]+\s*\{[^}]*\}/g;

/**
 * Browsers ignore `@property` inside shadow roots, so Tailwind's registered custom
 * properties are added to the document once. They only declare initial values.
 */
function ensureDocumentProperties(doc: Document) {
  if (doc.getElementById("kushex-properties")) return;
  const rules = panelCss.match(PROPERTY_RULE);
  if (!rules) return;
  const style = doc.createElement("style");
  style.id = "kushex-properties";
  style.textContent = rules.join("\n");
  doc.head.appendChild(style);
}

let documentStyleUsers = 0;

/** Adds the panel CSS where the panel renders; returns a cleanup function. */
export function injectStyles(target: ShadowRoot | HTMLElement): () => void {
  const doc = target.ownerDocument;
  if (target instanceof ShadowRoot) {
    ensureDocumentProperties(doc);
    const style = doc.createElement("style");
    style.dataset.kushex = "";
    // Preflight is safe here: it cannot leave the shadow root.
    style.textContent = `${preflightCss}\n${panelCss}`;
    target.prepend(style);
    return () => style.remove();
  }
  // Light DOM: no preflight (it would restyle the host page); shared once per document.
  documentStyleUsers += 1;
  if (!doc.getElementById("kushex-styles")) {
    const style = doc.createElement("style");
    style.id = "kushex-styles";
    style.textContent = panelCss;
    doc.head.appendChild(style);
  }
  return () => {
    documentStyleUsers -= 1;
    if (documentStyleUsers === 0) doc.getElementById("kushex-styles")?.remove();
  };
}
