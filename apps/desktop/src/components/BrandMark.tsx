interface BrandMarkProps {
  size?: number;
  className?: string;
}

/** The shared TaxFlow document-check mark used across the desktop app. */
export function BrandMark({ size = 14, className }: BrandMarkProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 30 30"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M7.5 9.5h15M7.5 14h10M7.5 18.5H13"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        opacity=".72"
      />
      <path d="m15 19 3.1 3.1 6-7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
