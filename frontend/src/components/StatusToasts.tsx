export interface Toast {
  id: string;
  type: "success" | "error";
  text: string;
}

interface StatusToastsProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

export function StatusToasts({ toasts, onDismiss }: StatusToastsProps) {
  return (
    <div className="toast-wrap">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.type}`} onClick={() => onDismiss(t.id)}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
