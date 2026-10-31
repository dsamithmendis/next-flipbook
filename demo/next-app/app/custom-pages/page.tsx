"use client";

import { FlipBook, type FlipBookPageInput } from "next-flipbook";
import { useState } from "react";
import { Nav } from "../Nav";

function Counter() {
  const [count, setCount] = useState(0);
  return (
    <button type="button" onClick={() => setCount((value) => value + 1)}>
      Clicked {count} times
    </button>
  );
}

const pages: FlipBookPageInput[] = [
  {
    type: "custom",
    component: (
      <div className="custom-page">
        <h2>Pages can be React</h2>
        <p>Anything you can render can be a page: text, forms, charts, embedded components.</p>
      </div>
    ),
  },
  {
    type: "custom",
    render: () => (
      <div className="custom-page">
        <h2>State works</h2>
        <p>This page keeps its own state while it is visible.</p>
        <Counter />
      </div>
    ),
  },
  { type: "image", src: "/pages/page-3.svg", width: 600, height: 800 },
  {
    type: "custom",
    component: (
      <div className="custom-page">
        <h2>Mixed books</h2>
        <p>Images and React pages can sit side by side in one book.</p>
      </div>
    ),
  },
];

export default function CustomPagesDemo() {
  return (
    <main>
      <h1>Custom React pages</h1>
      <p className="lede">Images and React components mixed in one book.</p>
      <Nav />
      <FlipBook pages={pages} aspectRatio="3/4" height="72vh" />
    </main>
  );
}
