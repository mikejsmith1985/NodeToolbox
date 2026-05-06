// AppCard.tsx — Single tool card component used by the Home view grid.

import type { HTMLAttributes } from 'react';
import { Link } from 'react-router-dom';

import styles from './AppCard.module.css';

/** Props accepted by the reusable AppCard component. */
export interface AppCardProps {
  id: string;
  icon: string;
  title: string;
  description: string;
  tags: readonly string[];
  route: string;
  dragHandleProps?: HTMLAttributes<HTMLDivElement>;
}

/** Renders one navigable tool card with icon, summary, and tag metadata. */
export function AppCard({
  id,
  icon,
  title,
  description,
  tags,
  route,
  dragHandleProps,
}: AppCardProps) {
  return (
    <Link className={styles.card} data-card-id={id} to={route}>
      <div className={styles.icon} {...dragHandleProps}>
        {icon}
      </div>
      <h3 className={styles.title}>{title}</h3>
      <p className={styles.description}>{description}</p>
      <div className={styles.tags}>
        {tags.map((tagLabel) => (
          <span key={tagLabel} className={styles.tag}>
            {tagLabel}
          </span>
        ))}
      </div>
    </Link>
  );
}
