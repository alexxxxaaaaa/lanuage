import * as pdfjsLib from 'pdfjs-dist'
// Vite-friendly worker import: `?url` gives us the compiled worker's URL as a
// string, which pdf.js needs to spin up the background thread. Without a
// worker configured, pdf.js falls back to blocking the main thread.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

// Version-pinned CDN URLs for pdf.js's CJK CMap data and standard font data.
// Used by the (currently unused) text-extraction path; harmless to keep set —
// pdf.js only fetches these when a document actually needs them.
const PDFJS_VERSION = '5.6.205'
const PDFJS_CMAP_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/cmaps/`
const PDFJS_STANDARD_FONT_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/standard_fonts/`

export type ExtractProgress = (progress: {
  page: number
  totalPages: number
}) => void

/**
 * Render every page of a PDF to a JPEG data URL. Used by the exam-upload
 * flow to send visual page images to a vision-capable LLM, which handles any
 * font encoding / scan / weird layout — the pdfjs text-extraction path
 * silently returned garbage on real JLPT PDFs because those embed CJK fonts
 * without ToUnicode maps.
 *
 * @param file       PDF file from an <input type="file"> pick
 * @param onProgress optional callback for per-page rendering progress
 * @param scale      canvas render scale; 1.5 = ~150 DPI, decent OCR fidelity
 * @param quality    JPEG quality 0-1; 0.8 hits the ~150KB/page sweet spot
 * @returns          one data-URL per page in document order
 */
export async function renderPdfPagesToImages(
  file: File,
  onProgress?: ExtractProgress,
  scale = 1.5,
  quality = 0.8,
): Promise<string[]> {
  const buffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({
    data: buffer,
    cMapUrl: PDFJS_CMAP_URL,
    cMapPacked: true,
    standardFontDataUrl: PDFJS_STANDARD_FONT_URL,
    // Fall back to the browser/OS fonts when the PDF embeds subset fonts
    // without a ToUnicode / usable CMap. This is the recovery path for
    // solution booklets that render blank because their embedded fonts
    // can't be interpreted by pdf.js's built-in engine.
    useSystemFonts: true,
    // Some PDF authoring tools produce fonts that only work when the
    // fetched font data is bundled with the built-in font blobs. This
    // flag is ignored on modern pdfjs but harmless on older ones.
    isEvalSupported: false,
  }).promise
  const totalPages = pdf.numPages
  const images: string[] = []

  for (let i = 1; i <= totalPages; i++) {
    onProgress?.({ page: i, totalPages })
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d context unavailable')
    // White background — some PDFs draw text without any background fill,
    // which then transparent-composites weirdly when the image is JPEG-encoded.
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvas, canvasContext: ctx, viewport }).promise
    // JPEG for size; PDF exam pages are essentially black-on-white with no
    // photo-like gradients, so JPEG artifacts are negligible and payload
    // shrinks vs PNG by ~5-10x.
    const dataUrl = canvas.toDataURL('image/jpeg', quality)
    images.push(dataUrl)
    // Release the canvas so long PDFs don't balloon RAM.
    canvas.width = 0
    canvas.height = 0
  }

  return images
}
