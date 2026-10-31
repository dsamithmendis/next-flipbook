import type { FlipBookPageInput } from "next-flipbook";

/** Ten SVG pages in /public/pages. Page 1 and page 10 are the covers. */
export const imagePages: FlipBookPageInput[] = Array.from({ length: 10 }, (_, index) => ({
  type: "image",
  src: `/pages/page-${index + 1}.svg`,
  alt: `Demo page ${index + 1}`,
  width: 600,
  height: 800,
}));
