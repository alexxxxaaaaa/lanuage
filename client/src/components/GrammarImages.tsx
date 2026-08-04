/**
 * 语法条目附的图。
 *
 * 别把它当插图 —— 书里凡是要用大括号把几种词性并成一条的接续规则，都是排成
 * 图的（纯文本排不出跨行的大括号）。带图的 149 条里，136 条的文字接续字段是
 * 空的，图就是那一栏的正文。所以它跟在「接续」下面，而不是单独一块放在页尾。
 * N5 的助数词表、基数词读法表也走这里。
 *
 * 图是黑字白底的书页截图。JPEG 不透明，所以底色只在四周的 padding 上看得见 ——
 * 白边把图和卡片背景隔开，深色主题下再压一点亮度，免得整块白刺眼。
 */

// 这批图是按 ~2.5x 密度导出的：一行字占 68-73 像素，而正文行高才 26 左右。
// 照原始像素铺出来，图里的字会比正文大两倍半，在普通屏上就是一张放大的位图，
// 糊。缩到 0.4 之后每行约 27px 与正文齐平，高 DPI 屏上还剩 2.5 倍密度，锐利。
//
// 缩放放在 onLoad 里按 naturalWidth 现算，而不是写死一个 max-width —— 这批图
// 从 317px 宽的两行接续到 1535px 宽的助数词表都有，同一个上限套不住两头。
const DISPLAY_SCALE = 0.4

export function GrammarImages({
  images,
  pattern,
  maxHeight,
  className = '',
}: {
  images: string[]
  pattern: string
  /** 有高度上限的地方（复习翻卡）传它，按比例再收一档，而不是把图截断。 */
  maxHeight?: number
  className?: string
}) {
  if (images.length === 0) return null
  return (
    <div className={`flex flex-col items-start gap-2 ${className}`.trim()}>
      {images.map((src) => (
        <img
          key={src}
          src={src}
          alt={`${pattern} 的接续`}
          loading="lazy"
          onLoad={(event) => {
            const el = event.currentTarget
            if (!el.naturalWidth) return
            let width = el.naturalWidth * DISPLAY_SCALE
            // 高度超了就整体再等比缩，只设 max-height 的话宽度还是定死的，
            // 图会被压扁。
            if (maxHeight) {
              const height = el.naturalHeight * DISPLAY_SCALE
              if (height > maxHeight) width *= maxHeight / height
            }
            el.style.width = `${Math.round(width)}px`
          }}
          // 缩放要等图加载完才算得出来，先用 40% 容器宽兜着，免得加载的瞬间
          // 闪一张原始大小的图。max-w-full 管窄屏：最宽那张 1535px 缩完还有
          // 614px，手机上放不下，由它压回屏宽。
          className="max-w-full rounded-md bg-white p-1.5 [width:40%] dark:brightness-90"
        />
      ))}
    </div>
  )
}
