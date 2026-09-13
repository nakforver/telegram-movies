import type { ReactNode } from 'react';

interface SectionProps {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  onTitleClick?: () => void;
}

export default function Section({ title, action, children, onTitleClick }: SectionProps) {
  return (
    <section className="section">
      <header>
        <h2>
          {onTitleClick
            ? <button className="section-title" onClick={onTitleClick}>{title}</button>
            : title}
        </h2>
        {action}
      </header>
      {children}
    </section>
  );
}
