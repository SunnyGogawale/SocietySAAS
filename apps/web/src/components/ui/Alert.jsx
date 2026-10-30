const roleByTone = { info: 'status', success: 'status', warning: 'alert', danger: 'alert' };

export function Alert({ children, title, tone = 'info' }) {
  return (
    <div className={`alert alert--${tone}`} role={roleByTone[tone] ?? 'status'}>
      <div>
        {title && <h2 className="alert__title">{title}</h2>}
        <div>{children}</div>
      </div>
    </div>
  );
}
