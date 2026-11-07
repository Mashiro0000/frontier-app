// (22.3, D-054) Image Studio's styles: words added under the description ("Style: ..."), the app's own, with no picture and no artist's name. A style is only text
// the person can see in the cost and in the gallery's description; main checks the whole description as it checks any (length, bytes).

export interface ImageStyle {
  id: string
  /** On the chip. */
  label: string
  /** Added under the description. */
  words: string
}

export const IMAGE_STYLES: readonly ImageStyle[] = [
  { id: 'photo', label: 'Photo', words: 'a natural photograph with soft daylight' },
  {
    id: 'watercolour',
    label: 'Watercolour',
    words: 'a loose watercolour painting on textured paper'
  },
  { id: 'oil', label: 'Oil painting', words: 'an oil painting with visible brush strokes' },
  {
    id: 'sketch',
    label: 'Pencil sketch',
    words: 'a pencil sketch, black and white, with light shading'
  },
  {
    id: 'flat',
    label: 'Flat illustration',
    words: 'a flat vector illustration with simple shapes and a few colours'
  },
  { id: 'render', label: '3D render', words: 'a clean 3D render with soft studio lighting' },
  { id: 'pixel', label: 'Pixel art', words: 'pixel art in a small, limited palette' },
  { id: 'line', label: 'Line art', words: 'clean black line art on a white background' },
  {
    id: 'isometric',
    label: 'Isometric',
    words: 'an isometric scene with crisp edges and soft colours'
  },
  { id: 'poster', label: 'Poster', words: 'a bold poster with strong shapes and space for a title' }
]
