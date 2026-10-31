"use client";

import { FlipBook } from "next-flipbook";
import { useEffect, useState } from "react";
import { Nav } from "../Nav";

// Builds a small password-protected PDF in the browser-free way: the file is
// fetched as bytes, which is also how you would pass a File from an <input>.
export default function PasswordDemo() {
  const [bytes, setBytes] = useState<ArrayBuffer | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/protected.pdf")
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then((buffer) => {
        if (!cancelled) setBytes(buffer);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main>
      <h1>Password-protected PDF</h1>
      <p className="lede">
        The password is <code>secret</code>. A built-in dialog asks for it; pass{" "}
        <code>onPassword</code> to use your own.
      </p>
      <Nav />
      {failed ? <p role="alert">The PDF could not be loaded.</p> : null}
      {bytes ? (
        <FlipBook source={bytes} pdf={{ workerSrc: "/pdf.worker.min.mjs" }} height="72vh" />
      ) : null}
    </main>
  );
}
