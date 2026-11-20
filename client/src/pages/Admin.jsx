import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorFields, formatDate, formatWhen, STATUS_LABEL } from '../api.js';
import { Badge, Empty, Field, Modal, Pagination, Spinner, statusSolid, useToast } from '../ui.jsx';

function useLoader(loader, deps) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const reload = () => {
    setLoading(true);
    return loader().then((result) => { setData(result); setError(''); return result; }).catch((err) => { setError(err.message); throw err; }).finally(() => setLoading(false));
  };
  useEffect(() => { reload().catch(() => {}); }, deps);
  return { data, error, loading, reload, setData };
}

export function AdminDashboard() {
  const { data, error, loading } = useLoader(() => api('/api/admin/stats'), []);
  if (loading) return <Spinner label="Loading dashboard" />;
  if (error) return <div className="banner"><strong>Could not load the dashboard</strong><p>{error}</p></div>;
  const cards = [
    ['Total restaurants', data.stats.totalRestaurants],
    ['Active', data.stats.activeRestaurants],
    ['Pending', data.stats.pendingRestaurants],
    ['Expired', data.stats.expiredRestaurants],
    ['Demo accounts', data.stats.demoAccounts],
    ['Paid accounts', data.stats.paidAccounts],
    ['Activation tokens', data.stats.totalTokens],
    [`Expiring in ${data.stats.expiringSoonDays} days`, data.stats.expiringSoon],
  ];
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Platform</h1>
          <p>Every restaurant on Scanora.</p>
        </div>
        <Link className="btn" to="/admin/tokens">Generate tokens</Link>
      </div>
      <div className="stats">
        {cards.map(([label, value]) => <div className="stat" key={label}><b>{value}</b><span>{label}</span></div>)}
      </div>
      <div className="grid-2" style={{ marginTop: 16 }}>
        <section className="card">
          <h2>Expiring soon</h2>
          {data.expiring.length === 0 ? <p className="muted">No subscriptions are inside the expiry window.</p> : (
            <div className="list">
              {data.expiring.map((restaurant) => (
                <Link key={restaurant.id} to={`/admin/restaurants/${restaurant.id}`} className="item" style={{ textDecoration: 'none' }}>
                  <strong>{restaurant.name}</strong>
                  <span className="muted">{restaurant.remainingDays} days · {restaurant.planLabel}</span>
                </Link>
              ))}
            </div>
          )}
        </section>
        <section className="card">
          <h2>Recent registrations</h2>
          <div className="list">
            {data.recent.map((restaurant) => (
              <Link key={restaurant.id} to={`/admin/restaurants/${restaurant.id}`} className="item" style={{ textDecoration: 'none' }}>
                <strong>{restaurant.name}</strong>
                <span className="muted">@{restaurant.username} · {formatDate(restaurant.registeredAt)}</span>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export function AdminRestaurants() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [approval, setApproval] = useState('');
  const [account, setAccount] = useState('');
  const [plan, setPlan] = useState('');
  const [validity, setValidity] = useState('');
  const [sort, setSort] = useState('created_at');
  const [dir, setDir] = useState('desc');
  const [page, setPage] = useState(1);
  const { data, error, loading } = useLoader(() => {
    const params = new URLSearchParams({ page, sort, dir, pageSize: 10 });
    if (query) params.set('search', query);
    if (approval) params.set('approval', approval);
    if (account) params.set('account', account);
    if (plan) params.set('plan', plan);
    if (validity) params.set('validity', validity);
    return api(`/api/admin/restaurants?${params}`);
  }, [query, approval, account, plan, validity, sort, dir, page]);

  function toggleSort(column) {
    if (sort === column) setDir((current) => (current === 'asc' ? 'desc' : 'asc'));
    else { setSort(column); setDir('asc'); }
    setPage(1);
  }

  return (
    <div className="page">
      <div className="page-header"><div><h1>Restaurants</h1><p>Search, filter, and open any account.</p></div></div>
      <form className="filters" onSubmit={(event) => { event.preventDefault(); setPage(1); setQuery(search.trim()); }}>
        <input className="input" placeholder="Name, username, or slug" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search restaurants" />
        <select className="select" aria-label="Approval" value={approval} onChange={(event) => { setApproval(event.target.value); setPage(1); }}>
          <option value="">All approvals</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <select className="select" aria-label="Account" value={account} onChange={(event) => { setAccount(event.target.value); setPage(1); }}>
          <option value="">All accounts</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="deactivated">Deactivated</option>
          <option value="blocked">Blocked</option>
        </select>
        <select className="select" aria-label="Plan" value={plan} onChange={(event) => { setPlan(event.target.value); setPage(1); }}>
          <option value="">All plans</option>
          <option value="none">No plan</option>
          <option value="demo">Demo</option>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </select>
        <select className="select" aria-label="Validity" value={validity} onChange={(event) => { setValidity(event.target.value); setPage(1); }}>
          <option value="">Any validity</option>
          <option value="active">Valid</option>
          <option value="expired">Expired</option>
          <option value="none">No expiry</option>
        </select>
        <button className="btn btn-secondary" type="submit">Search</button>
      </form>
      {loading ? <Spinner label="Loading restaurants" /> : null}
      {error ? <div className="banner"><strong>{error}</strong></div> : null}
      {data && data.items.length === 0 ? <Empty title="No restaurants" body="Try another search or filter." /> : null}
      {data && data.items.length > 0 ? (
        <>
          <div className="table-wrap">
            <table className="data cards">
              <thead>
                <tr>
                  <th><button className="sort" type="button" onClick={() => toggleSort('name')}>Restaurant</button></th>
                  <th><button className="sort" type="button" onClick={() => toggleSort('username')}>Username</button></th>
                  <th><button className="sort" type="button" onClick={() => toggleSort('created_at')}>Registered</button></th>
                  <th><button className="sort" type="button" onClick={() => toggleSort('plan')}>Plan</button></th>
                  <th>Status</th>
                  <th><button className="sort" type="button" onClick={() => toggleSort('expiry')}>Days left</button></th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((restaurant) => (
                  <tr key={restaurant.id}>
                    <td data-label="Restaurant"><strong>{restaurant.name}</strong></td>
                    <td data-label="Username">{restaurant.username}</td>
                    <td data-label="Registered">{formatDate(restaurant.registeredAt)}</td>
                    <td data-label="Plan">{restaurant.planLabel}</td>
                    <td data-label="Status"><Badge solid={statusSolid(restaurant.activationStatus)}>{STATUS_LABEL[restaurant.activationStatus]}</Badge></td>
                    <td data-label="Days left">{restaurant.remainingDays}</td>
                    <td data-label="Actions"><Link className="btn btn-secondary btn-sm" to={`/admin/restaurants/${restaurant.id}`}>View</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} totalPages={data.totalPages} onPage={setPage} />
        </>
      ) : null}
    </div>
  );
}

export function AdminRestaurantDetail() {
  const { id } = useParams();
  const toast = useToast();
  const { data, error, loading, reload } = useLoader(() => api(`/api/admin/restaurants/${id}`), [id]);
  const [days, setDays] = useState('30');
  const [plan, setPlan] = useState('monthly');
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [confirmName, setConfirmName] = useState('');
  const [busy, setBusy] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  async function act(path, body, success) {
    setBusy(true);
    try {
      const result = await api(path, { method: path.endsWith('/delete') ? 'DELETE' : 'POST', body: body || {} });
      toast(result.message || success);
      if (path.endsWith(`/${id}`) && path.includes('DELETE')) return;
      await reload();
    } catch (err) {
      toast(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner label="Loading restaurant" />;
  if (error || !data) return <div className="banner"><strong>{error || 'Not found'}</strong></div>;
  const restaurant = data.restaurant;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="kicker">Restaurant</p>
          <h1>{restaurant.name}</h1>
          <p>@{restaurant.username} · {restaurant.slug}</p>
        </div>
        <Badge solid={statusSolid(restaurant.activationStatus)}>{STATUS_LABEL[restaurant.activationStatus]}</Badge>
      </div>
      <div className="stats">
        <div className="stat"><b>{restaurant.remainingDays}</b><span>Days remaining</span></div>
        <div className="stat"><b>{data.counts.categories}</b><span>Categories</span></div>
        <div className="stat"><b>{data.counts.dishes}</b><span>Dishes</span></div>
        <div className="stat"><b>{restaurant.hasQr ? 'Yes' : 'No'}</b><span>QR code</span></div>
      </div>
      <section className="card" style={{ marginTop: 16 }}>
        <h2>Account</h2>
        <p className="muted">Registered {formatWhen(restaurant.registeredAt)}. Plan: {restaurant.planLabel}. Activation {formatDate(restaurant.activationDate)}. Expiry {formatDate(restaurant.expiryDate)}.</p>
        {restaurant.rejectionReason ? <p>Rejection note: {restaurant.rejectionReason}</p> : null}
        <div className="row-actions" style={{ marginTop: 12 }}>
          <button className="btn btn-sm" type="button" disabled={busy} onClick={() => act(`/api/admin/restaurants/${id}/approve`)}>Approve</button>
          <button className="btn btn-secondary btn-sm" type="button" disabled={busy} onClick={() => act(`/api/admin/restaurants/${id}/activate`)}>Activate</button>
          <button className="btn btn-secondary btn-sm" type="button" disabled={busy} onClick={() => act(`/api/admin/restaurants/${id}/deactivate`)}>Deactivate</button>
          <button className="btn btn-secondary btn-sm" type="button" disabled={busy} onClick={() => act(`/api/admin/restaurants/${id}/block`)}>Block</button>
          <button className="btn btn-secondary btn-sm" type="button" disabled={busy} onClick={() => act(`/api/admin/restaurants/${id}/unblock`)}>Unblock</button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => setRemoveOpen(true)}>Delete</button>
        </div>
        <form className="grid-2" style={{ marginTop: 16 }} onSubmit={(event) => { event.preventDefault(); act(`/api/admin/restaurants/${id}/reject`, { reason }); }}>
          <Field label="Rejection reason"><input value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
          <div className="field"><span> </span><button className="btn btn-secondary" type="submit" disabled={busy}>Reject registration</button></div>
        </form>
      </section>
      <section className="card">
        <h2>Subscription</h2>
        <p className="hint">Extending before expiry adds days to the current expiry. Extending after expiry starts from today. Existing dishes and the QR code stay in place.</p>
        <form className="grid-2" onSubmit={(event) => { event.preventDefault(); act(`/api/admin/restaurants/${id}/extend`, { days: Number(days) }); }}>
          <Field label="Extend by days"><input type="number" min="1" max="3650" value={days} onChange={(event) => setDays(event.target.value)} /></Field>
          <div className="field"><span>Manual extension</span><button className="btn" type="submit" disabled={busy}>Extend validity</button></div>
        </form>
        <form className="grid-2" onSubmit={(event) => { event.preventDefault(); act(`/api/admin/restaurants/${id}/assign-plan`, { plan }); }}>
          <Field label="Assign plan">
            <select value={plan} onChange={(event) => setPlan(event.target.value)}>
              <option value="demo">3-day Demo Plan</option>
              <option value="monthly">30-day Monthly Plan</option>
              <option value="yearly">365-day Yearly Plan</option>
            </select>
          </Field>
          <div className="field"><span>Plan</span><button className="btn btn-secondary" type="submit" disabled={busy}>Assign plan</button></div>
        </form>
      </section>
      <section className="card">
        <h2>Reset password</h2>
        <form className="grid-2" onSubmit={(event) => { event.preventDefault(); act(`/api/admin/restaurants/${id}/reset-password`, { password }); setPassword(''); }}>
          <Field label="New password"><input type="text" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" /></Field>
          <div className="field"><span> </span><button className="btn btn-secondary" type="submit" disabled={busy}>Reset password</button></div>
        </form>
      </section>
      <section className="card">
        <h2>Recent admin actions</h2>
        {data.logs.length === 0 ? <p className="muted">No actions yet.</p> : (
          <div className="list">
            {data.logs.map((log) => <div key={log.id}><strong>{log.action}</strong><div className="faint">{formatWhen(log.createdAt)}</div></div>)}
          </div>
        )}
      </section>
      {removeOpen ? (
        <Modal title="Delete restaurant" onClose={() => setRemoveOpen(false)}>
          <p>This removes the owner login, menu, and QR code. Type <strong>{restaurant.name}</strong> to confirm.</p>
          <Field label="Restaurant name" error={errorFields({})}>
            <input value={confirmName} onChange={(event) => setConfirmName(event.target.value)} />
          </Field>
          <div className="modal-actions">
            <button className="btn btn-secondary" type="button" onClick={() => setRemoveOpen(false)}>Cancel</button>
            <button className="btn" type="button" disabled={busy} onClick={async () => {
              setBusy(true);
              try {
                const result = await api(`/api/admin/restaurants/${id}`, { method: 'DELETE', body: { confirmName } });
                toast(result.message);
                window.location.href = '/admin/restaurants';
              } catch (err) {
                toast(err.message);
              } finally {
                setBusy(false);
              }
            }}>Delete account</button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

export function AdminTokens() {
  const toast = useToast();
  const [plan, setPlan] = useState('monthly');
  const [quantity, setQuantity] = useState('1');
  const [status, setStatus] = useState('');
  const [filterPlan, setFilterPlan] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [fresh, setFresh] = useState([]);
  const { data, loading, reload } = useLoader(() => {
    const params = new URLSearchParams({ page, pageSize: 10 });
    if (status) params.set('status', status);
    if (filterPlan) params.set('plan', filterPlan);
    if (query) params.set('search', query);
    return api(`/api/admin/tokens?${params}`);
  }, [status, filterPlan, query, page]);

  async function generate(event) {
    event.preventDefault();
    try {
      const result = await api('/api/admin/tokens', { method: 'POST', body: { plan, quantity: Number(quantity) } });
      setFresh(result.tokens);
      toast(result.message);
      setPage(1);
      await reload();
    } catch (error) {
      toast(error.message);
    }
  }

  async function copy(code) {
    try {
      await navigator.clipboard.writeText(code);
      toast('Token copied');
    } catch {
      toast(code);
    }
  }

  async function setBlocked(token, block) {
    try {
      const result = await api(`/api/admin/tokens/${token.id}/${block ? 'block' : 'unblock'}`, { method: 'POST', body: {} });
      toast(result.message);
      await reload();
    } catch (error) {
      toast(error.message);
    }
  }

  return (
    <div className="page">
      <div className="page-header"><div><h1>Activation tokens</h1><p>Each token works once. Demo is 3 days, monthly is 30, yearly is 365.</p></div></div>
      <form className="card grid-2" onSubmit={generate}>
        <Field label="Plan">
          <select value={plan} onChange={(event) => setPlan(event.target.value)}>
            <option value="demo">3-day Demo Plan</option>
            <option value="monthly">30-day Monthly Plan</option>
            <option value="yearly">365-day Yearly Plan</option>
          </select>
        </Field>
        <Field label="Quantity"><input type="number" min="1" max="100" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></Field>
        <button className="btn" type="submit">Generate</button>
      </form>
      {fresh.length > 0 ? (
        <section className="card">
          <h2>Just generated</h2>
          <div className="list">
            {fresh.map((token) => (
              <div className="item" key={token.id}>
                <strong>{token.code}</strong>
                <span className="muted">{token.planLabel}</span>
                <button className="btn btn-secondary btn-sm" type="button" onClick={() => copy(token.code)}>Copy</button>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      <form className="filters" onSubmit={(event) => { event.preventDefault(); setPage(1); setQuery(search.trim()); }}>
        <input className="input" placeholder="Code or restaurant" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search tokens" />
        <select className="select" aria-label="Token status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          <option value="unused">Unused</option>
          <option value="redeemed">Redeemed</option>
          <option value="blocked">Blocked</option>
        </select>
        <select className="select" aria-label="Token plan" value={filterPlan} onChange={(event) => { setFilterPlan(event.target.value); setPage(1); }}>
          <option value="">All plans</option>
          <option value="demo">Demo</option>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </select>
        <button className="btn btn-secondary" type="submit">Search</button>
      </form>
      {loading ? <Spinner label="Loading tokens" /> : null}
      {data && data.items.length === 0 ? <Empty title="No tokens" body="Generate a token to activate a restaurant." /> : null}
      {data && data.items.length > 0 ? (
        <>
          <div className="table-wrap">
            <table className="data cards">
              <thead>
                <tr><th>Token</th><th>Plan</th><th>Status</th><th>Restaurant</th><th>Generated</th><th>Redeemed</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {data.items.map((token) => (
                  <tr key={token.id}>
                    <td data-label="Token"><strong>{token.code}</strong></td>
                    <td data-label="Plan">{token.planLabel}</td>
                    <td data-label="Status"><Badge solid={token.status !== 'unused'}>{token.status}</Badge></td>
                    <td data-label="Restaurant">{token.restaurantName || '—'}</td>
                    <td data-label="Generated">{formatWhen(token.createdAt)}</td>
                    <td data-label="Redeemed">{formatWhen(token.redeemedAt)}</td>
                    <td data-label="Actions">
                      <div className="row-actions">
                        <button className="btn btn-secondary btn-sm" type="button" onClick={() => copy(token.code)}>Copy</button>
                        {token.status === 'unused' ? <button className="btn btn-ghost btn-sm" type="button" onClick={() => setBlocked(token, true)}>Block</button> : null}
                        {token.status === 'blocked' ? <button className="btn btn-secondary btn-sm" type="button" onClick={() => setBlocked(token, false)}>Unblock</button> : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} totalPages={data.totalPages} onPage={setPage} />
        </>
      ) : null}
    </div>
  );
}

export function AdminAudit() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const { data, loading } = useLoader(() => {
    const params = new URLSearchParams({ page, pageSize: 15 });
    if (query) params.set('search', query);
    return api(`/api/admin/audit?${params}`);
  }, [query, page]);
  return (
    <div className="page">
      <div className="page-header"><div><h1>Audit log</h1><p>Approvals, tokens, extensions, blocks, and settings.</p></div></div>
      <form className="filters" onSubmit={(event) => { event.preventDefault(); setPage(1); setQuery(search.trim()); }}>
        <input className="input" placeholder="Search action or details" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search audit log" />
        <button className="btn btn-secondary" type="submit">Search</button>
      </form>
      {loading ? <Spinner label="Loading audit log" /> : null}
      {data && data.items.length === 0 ? <Empty title="No events" body="Admin actions will appear here." /> : null}
      {data && data.items.length > 0 ? (
        <>
          <div className="list">
            {data.items.map((log) => (
              <article className="item" key={log.id}>
                <strong>{log.action}</strong>
                <span className="muted">{formatWhen(log.createdAt)}</span>
                <span className="faint">{JSON.stringify(log.details)}</span>
              </article>
            ))}
          </div>
          <Pagination page={data.page} totalPages={data.totalPages} onPage={setPage} />
        </>
      ) : null}
    </div>
  );
}

export function AdminSettings() {
  const toast = useToast();
  const { data, loading, reload } = useLoader(() => api('/api/admin/settings'), []);
  const [behavior, setBehavior] = useState('message');
  const [days, setDays] = useState('7');
  useEffect(() => {
    if (data?.settings) {
      setBehavior(data.settings.expiredMenuBehavior);
      setDays(String(data.settings.expiringSoonDays));
    }
  }, [data]);
  if (loading) return <Spinner label="Loading settings" />;
  return (
    <div className="page">
      <div className="page-header"><div><h1>Settings</h1><p>Customer-facing behavior when a subscription expires. Owner data is never deleted.</p></div></div>
      <form className="card" onSubmit={async (event) => {
        event.preventDefault();
        try {
          const result = await api('/api/admin/settings', { method: 'PUT', body: { expiredMenuBehavior: behavior, expiringSoonDays: Number(days) } });
          toast(result.message);
          await reload();
        } catch (error) {
          toast(error.message);
        }
      }}>
        <div className="choice">
          {[
            ['hide', 'Hide the menu', 'Guests see a generic unavailable message and no dishes.'],
            ['message', 'Subscription expired message', 'Guests see that the subscription has expired.'],
            ['readonly', 'Read-only menu', 'Guests can still browse the latest saved menu.'],
          ].map(([value, title, copy]) => (
            <label key={value}>
              <span><input type="radio" name="behavior" checked={behavior === value} onChange={() => setBehavior(value)} /> <strong>{title}</strong></span>
              <span className="muted">{copy}</span>
            </label>
          ))}
        </div>
        <Field label="Expiring soon window (days)">
          <input type="number" min="1" max="90" value={days} onChange={(event) => setDays(event.target.value)} />
        </Field>
        <button className="btn" type="submit">Save settings</button>
      </form>
    </div>
  );
}
