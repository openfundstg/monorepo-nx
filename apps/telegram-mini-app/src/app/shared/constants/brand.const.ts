/**
 * The product's name and mark.
 *
 * Not an i18n key: a brand name is the same word in every dictionary, and a key
 * that must hold one identical value in `en`, `ru` and `uk` is three chances to
 * mistype it. The mark's own path sits beside it for the same reason the name
 * does — one place to change when the artwork is replaced.
 */
export const BRAND_NAME = 'Open Funds'

/**
 * Cut from the artwork with the ground removed, so the cream mark can be placed
 * on any of the palette's surfaces rather than dragging its own black tile
 * along. Served from `public/`, hence no `assets/` prefix.
 */
export const BRAND_MARK_SRC = 'logo.png'
