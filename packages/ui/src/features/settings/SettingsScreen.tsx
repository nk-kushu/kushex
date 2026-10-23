import { Form, Input, Menu, Radio, Typography } from "antd";
import { useState } from "react";
import { useAppDispatch, useAppSelector } from "../../app/hooks";
import { borderR } from "../../shared/lib/styles";
import { colorModeChanged, densityChanged, selectColorMode, selectDensity, type ColorMode, type Density } from "./settingsSlice";

const sections = ["General", "Appearance", "Project", "Agent"] as const;
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

export function SettingsScreen() {
  const [section, setSection] = useState<Section>("General");
  return (
    <div className="kx:h-full kx:overflow-auto kx:p-6">
      <Typography.Title level={3}>Settings</Typography.Title>
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
