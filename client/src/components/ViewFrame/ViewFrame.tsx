// ViewFrame.tsx — Shared responsive page wrapper for top-level Toolbox views.

import { forwardRef, type ReactNode } from 'react';

import styles from './ViewFrame.module.css';

/** Width options supported by the shared view frame wrapper. */
export type ViewFrameWidth = 'narrow' | 'standard' | 'wide' | 'full';

/** Props for the shared view frame wrapper used by top-level Toolbox views. */
export interface ViewFrameProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  width?: ViewFrameWidth;
  headerAlign?: 'start' | 'center';
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
}

const widthClassNameByVariant: Record<ViewFrameWidth, string> = {
  narrow: styles.widthNarrow,
  standard: styles.widthStandard,
  wide: styles.widthWide,
  full: styles.widthFull,
};

/** Builds one safe className string so optional wrapper props do not leak "undefined" into the DOM. */
function buildClassNameList(classNameValues: Array<string | undefined>): string {
  return classNameValues.filter(Boolean).join(' ');
}

/** Renders a shared responsive page frame with a standard title, subtitle, and body spacing contract. */
const ViewFrame = forwardRef<HTMLDivElement, ViewFrameProps>(function ViewFrame(
  {
    title,
    subtitle,
    children,
    width = 'standard',
    headerAlign = 'start',
    className,
    headerClassName,
    bodyClassName,
  },
  forwardedRef,
) {
  return (
    <div className={buildClassNameList([styles.viewFrame, widthClassNameByVariant[width], className])} ref={forwardedRef}>
      <header className={buildClassNameList([styles.header, headerAlign === 'center' ? styles.headerCenter : undefined, headerClassName])}>
        <h1 className={styles.title}>{title}</h1>
        {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
      </header>
      <div className={buildClassNameList([styles.body, bodyClassName])}>{children}</div>
    </div>
  );
});

export default ViewFrame;
