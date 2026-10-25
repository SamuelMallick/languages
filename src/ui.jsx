import { useEffect, useId, useRef } from 'react';
import { X, AlertCircle, LoaderCircle, ArrowUpRight } from 'lucide-react';

export async function api(url, options = {}) {
  const { body, ...rest } = options;
  const isForm = body instanceof FormData;
  const response = await fetch(`/api${url}`, {
    ...rest, headers: isForm ? undefined : { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: isForm ? body : JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || 'Something went wrong. Please try again.');
    error.code = data.code; error.status = response.status; error.requestId = data.requestId;
    throw error;
  }
  return data;
}
export function ErrorNotice({ error, onClose }) {
  return error ? <div className="notice error" role="alert"><AlertCircle size={18} /><span>{error}</span>{onClose && <button className="icon-button" aria-label="Dismiss error" onClick={onClose}><X size={16} /></button>}</div> : null;
}
export function Busy({ children = 'Loading…' }) { return <div className="busy" role="status"><LoaderCircle size={20} className="spin" />{children}</div>; }
export function Modal({ title, children, onClose, wide = false, className = '' }) {
  const ref = useRef();
  const titleId = useId();
  useEffect(() => { const dialog = ref.current; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} aria-labelledby={titleId} className={`modal ${wide ? 'wide' : ''} ${className}`} onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === ref.current) onClose(); }}>
    <div className="modal-inner"><header className="modal-header"><h2 id={titleId}>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={20} /></button></header>{children}</div>
  </dialog>;
}
export function Flag({ code, large = false }) {
  return <span aria-hidden="true" className={`flag flag-${code.toLowerCase()} ${large ? 'large' : ''}`}>{code === 'TR' ? <span>☾</span> : code === 'NL' ? '' : code.slice(0, 2)}</span>;
}
export function EmptyState({ icon: Icon, title, children, action }) {
  return <div className="empty-state"><h3>{title}</h3><p>{children}</p>{action}</div>;
}
export function ExternalLink({ href, children }) { return <a href={href} target="_blank" rel="noreferrer">{children}<ArrowUpRight size={14} /></a>; }
