export function Button({
  children,
  className = '',
  variant = 'primary',
  type = 'button',
  ...props
}) {
  return (
    <button
      className={`button button--${variant}${className ? ` ${className}` : ''}`}
      type={type}
      {...props}
    >
      {children}
    </button>
  );
}
