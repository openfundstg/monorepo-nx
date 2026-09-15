import type { ReceiptFile } from 'src/shared/interfaces'

/**
 * A receipt as it reaches the panel.
 *
 * An alias, not a copy: the shape is `ReceiptFile` in `src/shared/interfaces/`,
 * where the verification path can name it too without importing the panel. The
 * name stays because the panel's own callers read better for it — `uploadCheck`
 * takes a receipt *for the panel* — and because every existing importer keeps
 * working.
 */
export type PanelReceiptFile = ReceiptFile
