export function FormField({ id, label, hint, error, as: Element = 'input', children, ...props }) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="form-field">
      <label className="form-field__label" htmlFor={id}>
        {label}
      </label>
      <Element
        className={`form-control${error ? ' form-control--error' : ''}`}
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
        {...props}
      >
        {children}
      </Element>
      {hint && (
        <span className="form-field__hint" id={hintId}>
          {hint}
        </span>
      )}
      {error && (
        <span className="form-field__error" id={errorId}>
          {error}
        </span>
      )}
    </div>
  );
}
