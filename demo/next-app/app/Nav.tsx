import Link from "next/link";

const links = [
  { href: "/", label: "Overview" },
  { href: "/playground", label: "Playground" },
  { href: "/images", label: "Images with cover" },
  { href: "/single", label: "Single page" },
  { href: "/features", label: "Toolbar & bookmarks" },
  { href: "/custom-toolbar", label: "Custom toolbar" },
  { href: "/zoom", label: "Zoom" },
  { href: "/search", label: "Search & contents" },
  { href: "/hotspots", label: "Hotspots & overlays" },
  { href: "/deep-links", label: "Deep links" },
  { href: "/pdf", label: "PDF" },
  { href: "/pdf-password", label: "Password PDF" },
  { href: "/pdf-bundled", label: "PDF, bundled worker" },
  { href: "/pdf-legacy", label: "PDF, older browsers" },
  { href: "/large-pdf", label: "Very long PDF" },
  { href: "/custom-pages", label: "Custom React pages" },
  { href: "/rtl", label: "Right to left" },
];

export function Nav() {
  return (
    <nav className="demo-nav" aria-label="Demos">
      {links.map((link) => (
        <Link key={link.href} href={link.href}>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
