export function Card({ children, className = '', title, ...props }) {
  return (
    <section className={`card${className ? ` ${className}` : ''}`} aria-label={title} {...props}>
      {title && <h2 className="card__title">{title}</h2>}
      {children}
    </section>
  );
}
