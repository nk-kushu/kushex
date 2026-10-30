import { Alert, Button, Form, Input, InputNumber, Menu, Radio, Typography } from "antd";
import { useState } from "react";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import { borderR } from "../../shared/lib/styles";
import {
  colorModeChanged,
  densityChanged,
  editorFontSizeChanged,
  FONT_SIZE_RANGE,
  noteFontSizeChanged,
  selectColorMode,
  selectDensity,
  selectEditorFontSize,
  selectNoteFontSize,
  type ColorMode,
  type Density,
  settingsRequested,
  settingsSaveRetried,
} from "./settingsSlice";

const sections = ["General", "Appearance", "Editor", "Project", "Agent"] as const;
type Section = (typeof sections)[number];

function AppearanceFields() {
  const dispatch = useAppDispatch();
  const colorMode = useAppSelector(selectColorMode);
  const density = useAppSelector(selectDensity);
  return (
    <>
      <Form.Item label="Color mode">
        <Radio.Group
          optionType="button"
          value={colorMode}
          onChange={(event) => dispatch(colorModeChanged(event.target.value as ColorMode))}
          options={[
            { label: "Light", value: "light" },
            { label: "Dark", value: "dark" },
            { label: "System", value: "system" },
          ]}
        />
      </Form.Item>
      <Form.Item label="Density">
        <Radio.Group
          optionType="button"
          value={density}
          onChange={(event) => dispatch(densityChanged(event.target.value as Density))}
          options={[
            { label: "Comfortable", value: "comfortable" },
            { label: "Compact", value: "compact" },
          ]}
        />
      </Form.Item>
    </>
  );
}

function EditorFields() {
  const dispatch = useAppDispatch();
  const editorFontSize = useAppSelector(selectEditorFontSize);
  const noteFontSize = useAppSelector(selectNoteFontSize);
  return (
    <>
      <Form.Item
        label="Font size"
        htmlFor="editor-font-size"
        extra="Applies to every code editor and diff view in the panel."
      >
        <InputNumber
          id="editor-font-size"
          {...FONT_SIZE_RANGE}
          precision={0}
          suffix="px"
          value={editorFontSize}
          onChange={(size) => {
            if (size !== null) dispatch(editorFontSizeChanged(size));
          }}
        />
      </Form.Item>
      <Form.Item
        label="Note font size"
        htmlFor="note-font-size"
        extra="Applies to the text of code notes in the agent editor."
      >
        <InputNumber
          id="note-font-size"
          {...FONT_SIZE_RANGE}
          precision={0}
          suffix="px"
          value={noteFontSize}
          onChange={(size) => {
            if (size !== null) dispatch(noteFontSizeChanged(size));
          }}
        />
      </Form.Item>
    </>
  );
}

export function SettingsScreen() {
  const dispatch = useAppDispatch();
  const { loadError, saveError } = useAppSelector((state) => state.settings);
  const [section, setSection] = useState<Section>("General");
  return (
    <div className="kx:h-full kx:overflow-auto kx:p-6">
      <Typography.Title level={3}>Settings</Typography.Title>
      {loadError && (
        <Alert
          type="error"
          title="Could not load your settings."
          action={<Button onClick={() => dispatch(settingsRequested())}>Retry load</Button>}
        />
      )}
      {saveError && (
        <Alert
          type="error"
          title="Your settings could not be saved."
          action={<Button onClick={() => dispatch(settingsSaveRetried())}>Retry save</Button>}
        />
      )}
      <div className="kx:grid kx:max-w-4xl kx:grid-cols-[12rem_1fr] kx:rounded-kx kx:bg-surface">
        <Menu
          mode="inline"
          className={borderR}
          style={{ borderInlineEnd: "none" }}
          selectedKeys={[section]}
          onClick={({ key }) => setSection(key as Section)}
          items={sections.map((name) => ({ key: name, label: name }))}
        />
        <div className="kx:p-6">
          <Typography.Title level={5}>{section}</Typography.Title>
          <Form layout="vertical" className="kx:max-w-md">
            {section === "Appearance" ? (
              <AppearanceFields />
            ) : section === "Editor" ? (
              <EditorFields />
            ) : (
              <>
                <Form.Item label="Field">
                  <Input />
                </Form.Item>
                <Form.Item label="Field">
                  <Input />
                </Form.Item>
              </>
            )}
          </Form>
        </div>
      </div>
    </div>
  );
}
