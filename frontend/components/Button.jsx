'use client';

/**
 * Shared button component — 5 variants: primary | secondary | danger | ghost | icon
 * Colors come from CSS custom properties (--btn-{variant}-{prop}) injected by /api/theme.css,
 * which reads button_styles_config from app_settings so admins can adjust per variant per theme.
 */
export default function Button({
  variant = 'primary',
  size,          // 'sm' | 'md' (default) | 'lg' — only for non-icon variants
  className = '',
  style = {},
  children,
  ...props
}) {
  const isIcon = variant === 'icon';

  const base = {
    background: `var(--btn-${variant}-bg)`,
    color: `var(--btn-${variant}-text)`,
    border: `1px solid var(--btn-${variant}-border)`,
    fontSize: `var(--btn-${variant}-size)`,
    fontFamily: 'inherit',
    fontWeight: 700,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'opacity 0.15s, transform 0.1s',
    flexShrink: 0,
    userSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
    ...style,
  };

  if (isIcon) {
    base.borderRadius = '50%';
    base.width = '38px';
    base.height = '38px';
    base.padding = '0';
  } else {
    base.borderRadius = '12px';
    if (size === 'sm') {
      base.padding = '6px 14px';
    } else if (size === 'lg') {
      base.padding = '14px 24px';
    } else {
      base.padding = '10px 20px';
    }
  }

  return (
    <button
      {...props}
      className={`active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${className}`}
      style={base}
    >
      {children}
    </button>
  );
}
