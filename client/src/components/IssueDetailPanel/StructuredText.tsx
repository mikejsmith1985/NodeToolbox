// StructuredText.tsx — Renders parsed StructuredBlock[] as readable headings, lists, and paragraphs.

import type { StructuredBlock } from '../../utils/richTextStructured.ts';
import styles from './IssueDetailPanel.module.css';

export interface StructuredTextProps {
  blocks: StructuredBlock[];
}

// Consecutive list items render inside one list element; anything else breaks the run.
interface RenderSegment {
  kind: 'list' | 'single';
  blocks: StructuredBlock[];
}

/** Groups consecutive list items into shared <ul> segments so lists render as lists. */
function groupIntoSegments(blocks: StructuredBlock[]): RenderSegment[] {
  const segments: RenderSegment[] = [];
  for (const block of blocks) {
    const lastSegment = segments[segments.length - 1];
    if (block.kind === 'listItem' && lastSegment?.kind === 'list') {
      lastSegment.blocks.push(block);
      continue;
    }
    segments.push({ kind: block.kind === 'listItem' ? 'list' : 'single', blocks: [block] });
  }
  return segments;
}

/** Renders structured description blocks; the caller decides when to show this vs. nothing. */
export function StructuredText({ blocks }: StructuredTextProps) {
  const segments = groupIntoSegments(blocks);
  return (
    <div className={styles.structuredText}>
      {segments.map((segment, segmentIndex) =>
        segment.kind === 'list' ? (
          <ul className={styles.structuredList} key={segmentIndex}>
            {segment.blocks.map((listBlock, itemIndex) => (
              <li
                className={listBlock.kind === 'listItem' && listBlock.level === 2 ? styles.structuredListItemNested : undefined}
                key={itemIndex}
              >
                {listBlock.text}
              </li>
            ))}
          </ul>
        ) : segment.blocks[0].kind === 'heading' ? (
          <h4 className={styles.structuredHeading} key={segmentIndex}>{segment.blocks[0].text}</h4>
        ) : (
          <p className={styles.structuredParagraph} key={segmentIndex}>{segment.blocks[0].text}</p>
        ),
      )}
    </div>
  );
}
