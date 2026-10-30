import { createContext, useContext } from "react";

export const DEFAULT_EDITOR_FONT_SIZE = 13;

/** The saved font size of the panel's Monaco editors; outside a panel, the default. */
export const EditorFontSizeContext = createContext(DEFAULT_EDITOR_FONT_SIZE);

export const useEditorFontSize = () => useContext(EditorFontSizeContext);
