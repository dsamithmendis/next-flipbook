# Using next-flipbook with Next.js

## App Router

```tsx
// app/layout.tsx
import "next-flipbook/styles.css"; // optional

// app/book/page.tsx (Server Component is fine when props are serializable)
import { FlipBook } from "next-flipbook";

export default function Page() {
  return <FlipBook pages={["/1.jpg", "/2.jpg"]} />;
}
```

Use a `"use client"` file when you pass functions (`render`, `renderLoader`, callbacks) or React elements as page `component`s.

## Pages Router, Vite, Remix

No special setup. Import `FlipBook` and, optionally, the stylesheet.

## Dynamic import

Not required. If you prefer to keep the viewer out of the server bundle entirely:

```tsx
const FlipBook = dynamic(() => import("next-flipbook").then((m) => m.FlipBook), { ssr: false });
```

## Container size

The viewer fills `width` and `height`. If a parent has no height, `height="100%"` collapses to nothing; give it a real height such as `"80vh"`.

## Images

Give image pages `width` and `height` (or set `aspectRatio`) to skip the one-time measurement of the first image, so the book appears as soon as the container is measured.
