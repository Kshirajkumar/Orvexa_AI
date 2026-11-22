interface BrandLogoProps {
  className: string;
}

export function BrandLogo({ className }: BrandLogoProps) {
  return (
    <span className={`brand-logo ${className}`} role="img" aria-label="Orvexa">
      <img className="brand-logo-light" src="/orvexa-logo.svg" alt="" aria-hidden="true" />
      <img className="brand-logo-dark" src="/orvexa-logo-dark.svg" alt="" aria-hidden="true" />
    </span>
  );
}
