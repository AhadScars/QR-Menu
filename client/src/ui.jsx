import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api, formatMoney } from './api.js';

const ToastContext = createContext(null);
const AuthContext = createContext(null);

export function useToast() {
  return useContext(ToastContext);
}

export function useAuth() {
  return useContext(AuthContext);
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = (message) => {
    const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setToasts((current) => [...current, { id, message }]);
    setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4200);
  };
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-wrap" aria-live="polite">
        {toasts.map((toast) => <div className="toast" key={toast.id} role="status">{toast.message}</div>)}
      </div>
    </ToastContext.Provider>
  );
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const data = await api('/api/auth/me');
    setUser(data.user);
    return data.user;
  };

  useEffect(() => {
    refresh().catch(() => setUser(null)).finally(() => setLoading(false));
    const onLost = () => setUser(null);
    window.addEventListener('auth:lost', onLost);
    return () => window.removeEventListener('auth:lost', onLost);
  }, []);

  const value = useMemo(() => ({ user, setUser, loading, refresh }), [user, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function Mark({ size = 28 }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2" />
      <rect x="6" y="6" width="8" height="8" fill="currentColor" />
      <rect x="18" y="6" width="8" height="8" fill="currentColor" />
      <rect x="6" y="18" width="8" height="8" fill="currentColor" />
      <rect x="18" y="20" width="3" height="3" fill="currentColor" />
      <rect x="23" y="20" width="3" height="3" fill="currentColor" />
      <rect x="18" y="25" width="3" height="3" fill="currentColor" />
    </svg>
  );
}

function moneyLine(discountCents, priceCents, symbol) {
  if (discountCents != null) {
    return (
      <>
        <span>{formatMoney(discountCents, symbol)}</span>
        <s>{formatMoney(priceCents, symbol)}</s>
      </>
    );
  }
  return formatMoney(priceCents, symbol);
}

export function DishPrice({ dish, symbol }) {
  if (dish.halfPriceCents == null) {
    return <div className="price">{moneyLine(dish.discountPriceCents, dish.priceCents, symbol)}</div>;
  }
  return (
    <div className="price">
      <span className="portion"><span className="portion-label">Half</span>{moneyLine(dish.halfDiscountPriceCents, dish.halfPriceCents, symbol)}</span>
      <span className="portion"><span className="portion-label">Full</span>{moneyLine(dish.discountPriceCents, dish.priceCents, symbol)}</span>
    </div>
  );
}

export function AvailabilitySwitch({ available, disabled, onToggle, dishName }) {
  return (
    <button
      className={available ? 'switch' : 'switch off'}
      type="button"
      role="switch"
      aria-checked={available}
      aria-label={available ? `Mark ${dishName} sold out` : `Mark ${dishName} available`}
      disabled={disabled}
      onClick={onToggle}
    >
      {available ? 'Available' : 'Sold out'}
    </button>
  );
}

export function Brand({ to = '/' }) {
  return <NavLink className="brand" to={to}><Mark /> Scanora</NavLink>;
}

export function Field({ label, error, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {error ? <span className="field-error">{error}</span> : null}
    </label>
  );
}

export function Modal({ title, children, onClose }) {
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Spinner({ label = 'Loading' }) {
  return <div className="center" role="status"><div className="spinner" /><span>{label}</span></div>;
}

export function Empty({ title, body, action }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      <p>{body}</p>
      {action ? <div style={{ marginTop: 12 }}>{action}</div> : null}
    </div>
  );
}

export function Pagination({ page, totalPages, onPage }) {
  if (!totalPages || totalPages <= 1) return null;
  return (
    <div className="pagination">
      <button className="btn btn-secondary btn-sm" type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
      <span className="muted">Page {page} of {totalPages}</span>
      <button className="btn btn-secondary btn-sm" type="button" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next</button>
    </div>
  );
}

export function Badge({ children, solid = false }) {
  return <span className={solid ? 'badge badge-solid' : 'badge'}>{children}</span>;
}

export class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="auth-screen">
          <div className="auth-card">
            <h1>This page could not open</h1>
            <p className="lede">{this.state.error.message}</p>
            <button className="btn" type="button" onClick={() => window.location.assign('/owner')}>Try again</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function Shell({ home, items, children }) {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const restaurant = user?.restaurant;

  async function logout() {
    await api('/api/auth/logout', { method: 'POST', body: {} });
    setUser(null);
    toast('Signed out');
    navigate(user?.role === 'super_admin' ? '/admin/login' : '/login');
  }

  return (
    <div className="app-shell">
      {open ? <button className="overlay" aria-label="Close menu" onClick={() => setOpen(false)} /> : null}
      <aside className={open ? 'sidebar open' : 'sidebar'}>
        <Brand to={home} />
        <nav className="side-nav" aria-label="Primary">
          {items.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`} onClick={() => setOpen(false)}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <div>{user?.username}</div>
          {restaurant ? <div className="faint">{restaurant.planLabel} · {restaurant.remainingDays} days left</div> : <div className="faint">Platform administrator</div>}
          <button className="btn btn-secondary btn-sm" type="button" style={{ marginTop: 10 }} onClick={logout}>Log out</button>
          <div className="faint" style={{ marginTop: 10 }}>Powered by DigiHub Solutions</div>
        </div>
      </aside>
      <div>
        <header className="topbar">
          <button className="btn btn-secondary menu-button" type="button" aria-label="Open menu" onClick={() => setOpen(true)}>☰</button>
          <Brand to={home} />
          <div className="user-chip">{restaurant?.name || user?.username}</div>
        </header>
        <main className="content">{children}<Outlet /></main>
      </div>
    </div>
  );
}

export function statusSolid(status) {
  return status === 'active' || status === 'blocked' || status === 'rejected';
}
