export function AuthPage({ children, description, title }) {
  return (
    <main className="auth-page">
      <section aria-labelledby="auth-title" className="auth-card">
        <a className="brand auth-brand" href="/" aria-label="SocietySAAS">
          <span className="brand__mark" aria-hidden="true">
            S
          </span>
          <span className="brand__name">SocietySAAS</span>
        </a>
        <h1 id="auth-title">{title}</h1>
        <p className="auth-card__description">{description}</p>
        {children}
      </section>
    </main>
  );
}
