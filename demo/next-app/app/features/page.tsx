import { FlipBook } from "next-flipbook";
import { Nav } from "../Nav";

// A Server Component: every option here is plain data.
export default function FeaturesDemo() {
  return (
    <main>
      <h1>Toolbar, thumbnails and bookmarks</h1>
      <p className="lede">
        Bookmark a page with the ribbon button or <code>B</code>, open the thumbnails, go fullscreen
        with <code>F</code>, and print, download or share. Bookmarks are remembered in this browser.
      </p>
      <Nav />
      <FlipBook
        source="/sample.pdf"
        pdf={{ workerSrc: "/pdf.worker.min.mjs" }}
        cover
        thumbnails
        bookmarks={{ persist: true }}
        download={{ filename: "sample.pdf" }}
        print
        share
        height="74vh"
      />
    </main>
  );
}
