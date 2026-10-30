import { useEffect, useRef } from 'react';
import { Button } from './Button.jsx';

export function Modal({ open, onClose, title, children, labelledBy = 'modal-title' }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    return undefined;
  }, [open]);

  return (
    <dialog
      aria-labelledby={labelledBy}
      className="modal"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      ref={dialogRef}
    >
      <div className="modal__header">
        <h2 id={labelledBy}>{title}</h2>
        <Button aria-label="Close dialog" onClick={onClose} variant="ghost">
          Close
        </Button>
      </div>
      <div className="modal__content">{children}</div>
    </dialog>
  );
}
