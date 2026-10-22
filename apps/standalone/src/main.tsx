import "@kushex/ui/preflight.css";
import { KushexPanel } from "@kushex/ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <KushexPanel instanceId="standalone" style={{ height: "100%" }} />
  </StrictMode>,
);
