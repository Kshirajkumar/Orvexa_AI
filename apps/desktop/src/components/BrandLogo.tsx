interface BrandLogoProps {
  className: string;
}

export function BrandLogo({ className }: BrandLogoProps) {
  return (
    <span className={`brand-logo ${className}`} role="img" aria-label="TaxFlow AI">
      <img className="brand-logo-light" src="/taxflow-ai-logo.svg" alt="" aria-hidden="true" />
      <img className="brand-logo-dark" src="/taxflow-ai-logo-dark.svg" alt="" aria-hidden="true" />
    </span>
  );
}
