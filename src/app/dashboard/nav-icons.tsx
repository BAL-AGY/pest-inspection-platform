// Minimal inline SVG icon set for the admin nav — deliberately not a new
// dependency (no icon-library package added). Each icon is a small, generic
// line-icon at a fixed 20x20 viewBox so they align consistently in the nav.

type IconProps = { className?: string };

const base = "h-5 w-5";

export function OverviewIcon({ className = base }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="6" height="6" rx="1" /><rect x="11" y="3" width="6" height="6" rx="1" />
      <rect x="3" y="11" width="6" height="6" rx="1" /><rect x="11" y="11" width="6" height="6" rx="1" />
    </svg>
  );
}

export function LeadsIcon({ className = base }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="6.5" r="2.5" /><path d="M2.5 17c0-2.8 2-4.5 4.5-4.5s4.5 1.7 4.5 4.5" />
      <circle cx="15" cy="7.5" r="2" /><path d="M12.5 17c.1-2.3 1.5-3.6 3-3.9" />
    </svg>
  );
}

export function CalendarIcon({ className = base }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="14" height="13" rx="2" /><path d="M3 8h14M7 2.5v3M13 2.5v3" />
    </svg>
  );
}

export function MarketingIcon({ className = base }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10l12-6v12L3 10z" /><path d="M15 7v6M6 12v3a1.5 1.5 0 003 0v-2" />
    </svg>
  );
}

export function IntelligenceIcon({ className = base }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2.5a5 5 0 00-3 9v1.5h6V11.5a5 5 0 00-3-9z" /><path d="M8 16.5h4M8.5 14.5h3" />
    </svg>
  );
}

export function IntegrationsIcon({ className = base }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="10" r="2.5" /><circle cx="15" cy="5" r="2.5" /><circle cx="15" cy="15" r="2.5" />
      <path d="M7.2 9l5.6-3M7.2 11l5.6 3" />
    </svg>
  );
}
