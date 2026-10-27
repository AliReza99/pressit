# @pressit/image-compare

React before/after image comparison: a split slider or side-by-side view, wheel zoom about the cursor (up to 16x, pixelated so artifacts show), drag to pan, double-click to reset.

```sh
pnpm add @pressit/image-compare
```

```tsx
import { ImageCompare } from '@pressit/image-compare';
import '@pressit/image-compare/style.css';

<ImageCompare before={originalUrl} after={compressedUrl} width={1200} height={1600} />
```

The component fills its parent's height, so give the parent (or `className`) one.

## Props

| Prop | Type | |
| --- | --- | --- |
| `before` | `string` | Original image url. |
| `after` | `string \| null` | Processed image url. `null` = pending: `before` shows in its place and the root gets `data-pending`. |
| `width`, `height` | `number` | Size of the `after` image; sets the frame's aspect ratio. |
| `beforeLabel`, `afterLabel` | `ReactNode` | Corner tags. |
| `tools` | `ReactNode` | Extra buttons, top-right, after the layout toggle. Give them class `ic-tool` to match. |
| `beforeStyle` | `CSSProperties` | Style for the `before` image wherever it must line up with `after`, e.g. a crop. Side by side, BEFORE shows whole. |
| `layout` | `'slider' \| 'side'` | Controlled layout. |
| `defaultLayout` | `'slider' \| 'side'` | Uncontrolled starting layout. Default `'slider'`. |
| `onLayoutChange` | `(layout) => void` | Fires when the layout toggle is pressed. |
| `splitKeys` | `'arrows' \| 'shift-arrows'` | Keys that move the split. Default `'arrows'`. |
| `className` | `string` | Added to the root. |

## Theming

Override the variables on `.ic-root`:

```css
.ic-root {
  --ic-ink: #16150f;      /* backdrop, borders, text */
  --ic-paper: #ebe7dc;    /* divider, tool buttons, before tag */
  --ic-accent: #d9421c;   /* knob, after tag, hover, focus */
  --ic-font: ui-monospace, monospace;
  --ic-radius: 0px;
  --ic-border: 2px;
}
```

Classes: `.ic-root`, `.ic-frame`, `.ic-divider`, `.ic-knob`, `.ic-tag`, `.ic-tag-before`, `.ic-tag-after`, `.ic-tools`, `.ic-tool`.
State: `.ic-root[data-layout='side']`, `.ic-root[data-pending]`, `.ic-frame[data-zoomed]`.

With Tailwind v4, import the stylesheet into a layer so utilities on `className` win:

```css
@import '@pressit/image-compare/style.css' layer(components);
```
