import Link from 'next/link';

interface AdminNavigationProps {
  /** Already filtered by the server using this session's effective permissions. */
  links: readonly { href: string; label: string }[];
}

export default function AdminNavigation({ links }: AdminNavigationProps) {
  return (
    <nav aria-label="Main navigation" className="admin-navigation">
      {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="admin-nav-link"
          >
            <span aria-hidden="true" className="admin-nav-mark">{link.label.slice(0, 1)}</span>
            {link.label}
          </Link>
      ))}
    </nav>
  );
}
