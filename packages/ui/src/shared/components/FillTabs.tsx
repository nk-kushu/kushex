import { Tabs, type TabsProps } from "antd";
import { createStyles } from "antd-style";

/** Layout only: tab panes fill the remaining height instead of sizing to content. */
const useStyles = createStyles(({ css, prefixCls }) => ({
  fill: css`
    height: 100%;
    display: flex;
    flex-direction: column;
    & > .${prefixCls}-tabs-nav {
      margin: 0;
    }
    & > .${prefixCls}-tabs-body-holder {
      flex: 1;
      min-height: 0;
    }
    & > .${prefixCls}-tabs-body-holder > .${prefixCls}-tabs-body,
    & > .${prefixCls}-tabs-body-holder > .${prefixCls}-tabs-body > .${prefixCls}-tabs-content {
      height: 100%;
    }
  `,
}));

export function FillTabs({ className, ...props }: TabsProps) {
  const { styles, cx } = useStyles();
  return <Tabs {...props} className={cx(styles.fill, className)} />;
}
