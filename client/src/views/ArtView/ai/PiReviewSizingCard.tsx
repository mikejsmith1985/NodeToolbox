// PiReviewSizingCard.tsx — The T-shirt sizing rubric, shown on the PI Review tab.
//
// Deliberately NOT gated behind the AI Assist unlock. The AI can apply this rubric, but most sizing
// is still done by hand, and the guidance page it comes from is three clicks away in Confluence —
// so the scale lives here, next to the table where the sizing actually happens.
//
// It renders from FEATURE_SIZING_SCALE, the same constant the AI prompt embeds, so the rubric a
// human reads and the rubric the model is given can never drift apart.

import { FEATURE_SIZING_SCALE, SIZING_GUIDANCE_URL } from './piReviewSizing.ts'
import styles from './PiReviewAi.module.css'

/** Renders the T-shirt sizing scale and a link to the Confluence guidance that owns it. */
export function PiReviewSizingCard(): React.JSX.Element {
  return (
    <details className={styles.sizingCard} data-export-exclude="true">
      <summary className={styles.sizingSummary}>📐 Feature sizing guide</summary>
      <table className={styles.sizingTable}>
        <thead>
          <tr>
            <th scope="col">T-Shirt Size</th>
            <th scope="col">User Story Points</th>
          </tr>
        </thead>
        <tbody>
          {FEATURE_SIZING_SCALE.map((entry) => (
            <tr key={entry.size}>
              <td>{entry.size}</td>
              <td>{entry.pointsLabel}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={styles.sizingHint}>
        <a href={SIZING_GUIDANCE_URL} rel="noreferrer" target="_blank">
          Feature sizing guidance ↗
        </a>
      </p>
    </details>
  )
}
