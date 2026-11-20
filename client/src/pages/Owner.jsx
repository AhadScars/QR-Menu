import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorFields, formatDate, STATUS_LABEL } from '../api.js';
import { AvailabilitySwitch, Badge, DishPrice, Empty, Field, Modal, Pagination, Spinner, statusSolid, useAuth, useToast } from '../ui.jsx';

function Gate({ restaurant, children }) {
  if (!restaurant) return null;
  if (restaurant.canManageMenu) return children;
  let title = 'Menu management is locked';
  let body = 'Activate the subscription to add or edit menu data. Existing data stays saved.';
  if (restaurant.activationStatus === 'pending') {
    title = 'Pending approval';
    body = 'Redeem an activation token or wait for the administrator to approve this account.';
  } else if (restaurant.activationStatus === 'expired') {
    title = 'Subscription expired';
    body = `Validity ended on ${formatDate(restaurant.expiryDate)}. Redeem a new token or ask the administrator to extend it. Categories, dishes, and the QR code are still stored.`;
  } else if (restaurant.activationStatus === 'blocked') {
    title = 'Account blocked';
    body = 'Contact the platform administrator.';
  } else if (restaurant.activationStatus === 'rejected') {
    title = 'Registration rejected';
    body = restaurant.rejectionReason || 'Contact the platform administrator.';
  } else if (restaurant.activationStatus === 'deactivated') {
    title = 'Account deactivated';
    body = 'The administrator deactivated this account. Your menu data is still stored.';
  }
  return <div className="banner"><strong>{title}</strong><p>{body}</p><p><Link to="/owner/subscription">Open subscription</Link></p>{children}</div>;
}

export function OwnerDashboard() {
  const toast = useToast();
  const { refresh } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [pendingId, setPendingId] = useState('');
  useEffect(() => {
    api('/api/owner/dashboard').then((result) => { setData(result); refresh(); }).catch((err) => setError(err.message));
  }, []);
  if (error) return <div className="banner"><strong>{error}</strong></div>;
  if (!data) return <Spinner label="Loading dashboard" />;
  const restaurant = data.restaurant;
  const dishes = Array.isArray(data.dishes) ? data.dishes : [];
  const counts = data.counts || { categories: 0, dishes: 0, availableDishes: 0, unavailableDishes: 0 };
  if (!restaurant?.name) return <div className="banner"><strong>Restaurant profile is missing</strong><p>Sign out and sign in again. If this stays empty, contact the administrator.</p></div>;
  const locked = !restaurant.canManageMenu;
  const needle = query.trim().toLowerCase();
  const visible = needle ? dishes.filter((dish) => String(dish.name || '').toLowerCase().includes(needle)) : dishes;
  const groups = [];
  for (const dish of visible) {
    const last = groups[groups.length - 1];
    if (!last || last.name !== dish.categoryName) groups.push({ name: dish.categoryName, dishes: [dish] });
    else last.dishes.push(dish);
  }

  async function toggle(dish) {
    if (locked || pendingId) return;
    const next = !dish.isAvailable;
    setPendingId(dish.id);
    setData((current) => {
      const counts = current.counts || { categories: 0, dishes: 0, availableDishes: 0, unavailableDishes: 0 };
      return {
        ...current,
        dishes: (current.dishes || []).map((item) => (item.id === dish.id ? { ...item, isAvailable: next } : item)),
        counts: {
          ...counts,
          availableDishes: Number(counts.availableDishes || 0) + (next ? 1 : -1),
          unavailableDishes: Number(counts.unavailableDishes || 0) + (next ? -1 : 1),
        },
      };
    });
    try {
      const result = await api(`/api/owner/dishes/${dish.id}/availability`, { method: 'POST', body: { isAvailable: next } });
      setData((current) => ({
        ...current,
        dishes: (current.dishes || []).map((item) => (item.id === dish.id ? { ...item, isAvailable: result.dish.isAvailable } : item)),
      }));
    } catch (err) {
      setData((current) => {
        const counts = current.counts || { categories: 0, dishes: 0, availableDishes: 0, unavailableDishes: 0 };
        return {
          ...current,
          dishes: (current.dishes || []).map((item) => (item.id === dish.id ? { ...item, isAvailable: dish.isAvailable } : item)),
          counts: {
            ...counts,
            availableDishes: Number(counts.availableDishes || 0) + (next ? -1 : 1),
            unavailableDishes: Number(counts.unavailableDishes || 0) + (next ? 1 : -1),
          },
        };
      });
      toast(err.message);
    } finally {
      setPendingId('');
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {restaurant.logoUrl ? <img className="avatar round" src={restaurant.logoUrl} alt="" /> : <div className="avatar round">{restaurant.name.slice(0, 1)}</div>}
          <div>
            <h1>{restaurant.name}</h1>
            <p>{restaurant.planLabel} · {STATUS_LABEL[restaurant.activationStatus]}</p>
          </div>
        </div>
        <Badge solid={statusSolid(restaurant.activationStatus)}>{STATUS_LABEL[restaurant.activationStatus]}</Badge>
      </div>
      <Gate restaurant={restaurant}><span /></Gate>
      <div className="stats">
        <div className="stat"><b>{restaurant.remainingDays}</b><span>Days remaining</span></div>
        <div className="stat"><b>{formatDate(restaurant.expiryDate)}</b><span>Expiry date</span></div>
        <div className="stat"><b>{counts.categories}</b><span>Categories</span></div>
        <div className="stat"><b>{counts.dishes}</b><span>Dishes</span></div>
        <div className="stat"><b>{counts.availableDishes}</b><span>Available</span></div>
        <div className="stat"><b>{counts.unavailableDishes}</b><span>Unavailable</span></div>
      </div>
      <section className="soldout">
        <h2>Sold out</h2>
        <p className="muted">Tap once during service. Guests still see the dish, marked unavailable.</p>
        {dishes.length === 0 ? <p className="hint">Add dishes to mark them sold out from here.</p> : (
          <>
            <input className="input" placeholder="Find a dish" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Find a dish" />
            {groups.length === 0 ? <p className="hint">No dishes match that name.</p> : groups.map((group) => (
              <div className="switch-group" key={group.name}>
                <h3>{group.name}</h3>
                <div className="switch-list">
                  {group.dishes.map((dish) => (
                    <div className="switch-row" key={dish.id}>
                      <strong>{dish.name}</strong>
                      <AvailabilitySwitch available={dish.isAvailable} disabled={locked || pendingId === dish.id} dishName={dish.name} onToggle={() => toggle(dish)} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </section>
      <div className="grid-2" style={{ marginTop: 16 }}>
        {[
          ['/owner/profile', 'Restaurant profile', 'Name, logo, cover, and contact details.'],
          ['/owner/categories', 'Categories', 'Create sections and set their order.'],
          ['/owner/dishes', 'Dishes', 'Prices and availability.'],
          ['/owner/qr', 'QR code', 'Preview, download, and print.'],
        ].map(([to, title, copy]) => (
          <Link key={to} to={to} className="card" style={{ textDecoration: 'none' }}>
            <h2 style={{ margin: '0 0 6px' }}>{title}</h2>
            <p className="muted" style={{ margin: 0 }}>{copy}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function OwnerProfile() {
  const toast = useToast();
  const { refresh } = useAuth();
  const [restaurant, setRestaurant] = useState(null);
  const [errors, setErrors] = useState({});
  const [passwordErrors, setPasswordErrors] = useState({});
  const [form, setForm] = useState(null);
  const [password, setPassword] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });

  useEffect(() => {
    api('/api/owner/profile').then((result) => {
      setRestaurant(result.restaurant);
      setForm({
        name: result.restaurant.name,
        description: result.restaurant.description,
        phone: result.restaurant.phone,
        email: result.restaurant.email,
        address: result.restaurant.address,
        currencySymbol: result.restaurant.currencySymbol,
      });
    }).catch((error) => toast(error.message));
  }, []);

  if (!form) return <Spinner label="Loading profile" />;

  function update(key) {
    return (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  }

  async function save(event) {
    event.preventDefault();
    const body = new FormData(event.target);
    Object.entries(form).forEach(([key, value]) => body.set(key, value));
    try {
      const result = await api('/api/owner/profile', { method: 'PUT', form: body });
      setRestaurant(result.restaurant);
      setErrors({});
      toast(result.message);
      refresh();
      event.target.reset();
    } catch (error) {
      setErrors(errorFields(error));
      toast(error.message);
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    try {
      const result = await api('/api/auth/password', { method: 'POST', body: password });
      setPasswordErrors({});
      setPassword({ currentPassword: '', newPassword: '', confirmPassword: '' });
      toast(result.message);
    } catch (error) {
      setPasswordErrors(errorFields(error));
      toast(error.message);
    }
  }

  return (
    <div className="page">
      <div className="page-header"><div><h1>Profile</h1><p>Shown at the top of the public menu.</p></div></div>
      <form className="card" onSubmit={save}>
        <div className="grid-2">
          <Field label="Restaurant name" error={errors.name}><input value={form.name} onChange={update('name')} /></Field>
          <Field label="Currency symbol" error={errors.currencySymbol}><input value={form.currencySymbol} onChange={update('currencySymbol')} maxLength={4} /></Field>
        </div>
        <Field label="Description" error={errors.description}><textarea value={form.description} onChange={update('description')} /></Field>
        <div className="grid-2">
          <Field label="Phone" error={errors.phone}><input value={form.phone} onChange={update('phone')} /></Field>
          <Field label="Email" error={errors.email}><input value={form.email} onChange={update('email')} /></Field>
        </div>
        <Field label="Address" error={errors.address}><input value={form.address} onChange={update('address')} /></Field>
        <div className="grid-2">
          <Field label="Logo"><input name="logo" type="file" accept="image/jpeg,image/png,image/webp" /></Field>
          <Field label="Cover image"><input name="cover" type="file" accept="image/jpeg,image/png,image/webp" /></Field>
        </div>
        <button className="btn" type="submit">Save profile</button>
        {restaurant?.logoUrl ? <p className="hint">Current logo is on the dashboard and the public menu.</p> : null}
      </form>
      <form className="card" onSubmit={changePassword}>
        <h2>Change password</h2>
        <Field label="Current password" error={passwordErrors.currentPassword}><input type="password" value={password.currentPassword} onChange={(event) => setPassword({ ...password, currentPassword: event.target.value })} /></Field>
        <Field label="New password" error={passwordErrors.newPassword}><input type="password" value={password.newPassword} onChange={(event) => setPassword({ ...password, newPassword: event.target.value })} /></Field>
        <Field label="Confirm password" error={passwordErrors.confirmPassword}><input type="password" value={password.confirmPassword} onChange={(event) => setPassword({ ...password, confirmPassword: event.target.value })} /></Field>
        <button className="btn btn-secondary" type="submit">Update password</button>
      </form>
    </div>
  );
}

export function OwnerCategories() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [targetId, setTargetId] = useState('');
  const [errors, setErrors] = useState({});
  const [dragId, setDragId] = useState(null);

  async function load() {
    const result = await api('/api/owner/categories');
    setData(result);
  }
  useEffect(() => { load().catch((error) => toast(error.message)); }, []);

  async function save(event) {
    event.preventDefault();
    const path = editing?.id ? `/api/owner/categories/${editing.id}` : '/api/owner/categories';
    const method = editing?.id ? 'PUT' : 'POST';
    try {
      const result = await api(path, {
        method,
        body: {
          name: event.target.name.value,
          description: event.target.description.value,
          isActive: event.target.isActive.checked,
        },
      });
      toast(result.message);
      setEditing(null);
      setErrors({});
      await load();
    } catch (error) {
      setErrors(errorFields(error));
      toast(error.message);
    }
  }

  async function reorder(ids) {
    const previous = data.categories;
    setData({ ...data, categories: ids.map((id) => previous.find((category) => category.id === id)) });
    try {
      await api('/api/owner/categories/reorder', { method: 'POST', body: { ids } });
    } catch (error) {
      toast(error.message);
      await load();
    }
  }

  function move(index, direction) {
    const ids = data.categories.map((category) => category.id);
    const next = index + direction;
    if (next < 0 || next >= ids.length) return;
    [ids[index], ids[next]] = [ids[next], ids[index]];
    reorder(ids);
  }

  async function removeCategory() {
    try {
      if (removing.dishCount > 0) {
        if (!targetId) { toast('Choose a category to receive the dishes'); return; }
        await api(`/api/owner/categories/${removing.id}/transfer`, { method: 'POST', body: { targetId } });
      }
      const result = await api(`/api/owner/categories/${removing.id}`, { method: 'DELETE' });
      toast(result.message);
      setRemoving(null);
      await load();
    } catch (error) {
      toast(error.message);
    }
  }

  if (!data) return <Spinner label="Loading categories" />;
  const locked = !data.restaurant.canManageMenu;
  return (
    <div className="page">
      <div className="page-header">
        <div><h1>Categories</h1><p>Order here is the order guests see.</p></div>
        <button className="btn" type="button" disabled={locked} onClick={() => { setErrors({}); setEditing({ name: '', description: '', isActive: true }); }}>Add category</button>
      </div>
      {locked ? <Gate restaurant={data.restaurant}><span /></Gate> : null}
      {data.categories.length === 0 ? <Empty title="No categories yet" body="Add Starters, Main Course, Beverages, or any section you serve." /> : null}
      <div className="list">
        {data.categories.map((category, index) => (
          <article
            className="item"
            key={category.id}
            draggable={!locked}
            onDragStart={() => setDragId(category.id)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (!dragId || dragId === category.id) return;
              const ids = data.categories.map((item) => item.id);
              const from = ids.indexOf(dragId);
              ids.splice(from, 1);
              ids.splice(index, 0, dragId);
              setDragId(null);
              reorder(ids);
            }}
          >
            <div>
              <h3>{category.name}</h3>
              <p>{category.description || 'No description'} · {category.dishCount} dishes · {category.isActive ? 'Active' : 'Hidden'}</p>
            </div>
            <div className="row-actions">
              <button className="btn btn-secondary btn-sm" type="button" disabled={locked || index === 0} onClick={() => move(index, -1)}>Up</button>
              <button className="btn btn-secondary btn-sm" type="button" disabled={locked || index === data.categories.length - 1} onClick={() => move(index, 1)}>Down</button>
              <button className="btn btn-secondary btn-sm" type="button" disabled={locked} onClick={() => { setErrors({}); setEditing(category); }}>Edit</button>
              <button className="btn btn-ghost btn-sm" type="button" disabled={locked} onClick={() => { setTargetId(''); setRemoving(category); }}>Delete</button>
            </div>
          </article>
        ))}
      </div>
      {editing ? (
        <Modal title={editing.id ? 'Edit category' : 'New category'} onClose={() => setEditing(null)}>
          <form key={editing.id || 'new-category'} onSubmit={save}>
            <Field label="Name" error={errors.name}><input name="name" defaultValue={editing.name} required /></Field>
            <Field label="Description" error={errors.description}><textarea name="description" defaultValue={editing.description || ''} /></Field>
            <label className="check"><input name="isActive" type="checkbox" value="true" defaultChecked={editing.isActive !== false} /> Active on the public menu</label>
            <div className="modal-actions">
              <button className="btn btn-secondary" type="button" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn" type="submit">Save</button>
            </div>
          </form>
        </Modal>
      ) : null}
      {removing ? (
        <Modal title="Delete category" onClose={() => setRemoving(null)}>
          {removing.dishCount > 0 ? (
            <>
              <p>This category has {removing.dishCount} dishes. Transfer them before it can be deleted. Permanent dish IDs stay the same.</p>
              <Field label="Move dishes to">
                <select value={targetId} onChange={(event) => setTargetId(event.target.value)}>
                  <option value="">Choose a category</option>
                  {data.categories.filter((category) => category.id !== removing.id).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
              </Field>
              {data.categories.length < 2 ? <p className="hint">Create another category, or delete the dishes first.</p> : null}
            </>
          ) : <p>Delete {removing.name}? This cannot be undone.</p>}
          <div className="modal-actions">
            <button className="btn btn-secondary" type="button" onClick={() => setRemoving(null)}>Cancel</button>
            <button className="btn" type="button" onClick={removeCategory}>{removing.dishCount > 0 ? 'Transfer and delete' : 'Delete'}</button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

const emptyDish = { name: '', description: '', price: '', discountPrice: '', halfPrice: '', halfDiscountPrice: '', categoryId: '', dietType: 'veg', isAvailable: true };

function dishFormState(dish) {
  return {
    ...dish,
    price: (dish.priceCents / 100).toFixed(2),
    discountPrice: dish.discountPriceCents == null ? '' : (dish.discountPriceCents / 100).toFixed(2),
    halfPrice: dish.halfPriceCents == null ? '' : (dish.halfPriceCents / 100).toFixed(2),
    halfDiscountPrice: dish.halfDiscountPriceCents == null ? '' : (dish.halfDiscountPriceCents / 100).toFixed(2),
  };
}

export function OwnerDishes() {
  const toast = useToast();
  const [categories, setCategories] = useState([]);
  const [restaurant, setRestaurant] = useState(null);
  const [result, setResult] = useState(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [availability, setAvailability] = useState('');
  const [sort, setSort] = useState('display_order');
  const [dir, setDir] = useState('asc');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  const [offerHalf, setOfferHalf] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [errors, setErrors] = useState({});
  const [pendingId, setPendingId] = useState('');

  async function loadDishes() {
    const params = new URLSearchParams({ page, pageSize: 10, sort, dir });
    if (query) params.set('search', query);
    if (categoryId) params.set('categoryId', categoryId);
    if (availability) params.set('availability', availability);
    const data = await api(`/api/owner/dishes?${params}`);
    setResult(data);
    setRestaurant(data.restaurant);
  }

  useEffect(() => {
    api('/api/owner/categories').then((data) => setCategories(data.categories)).catch((error) => toast(error.message));
  }, []);
  useEffect(() => { loadDishes().catch((error) => toast(error.message)); }, [query, categoryId, availability, sort, dir, page]);

  const locked = restaurant && !restaurant.canManageMenu;
  const symbol = restaurant?.currencySymbol || '₹';

  async function save(event) {
    event.preventDefault();
    const form = event.target;
    const path = editing?.id ? `/api/owner/dishes/${editing.id}` : '/api/owner/dishes';
    try {
      const data = await api(path, {
        method: editing?.id ? 'PUT' : 'POST',
        body: {
          name: form.name.value,
          description: form.description.value,
          categoryId: form.categoryId.value,
          price: form.price.value,
          discountPrice: form.discountPrice.value,
          offerHalf,
          halfPrice: offerHalf ? form.halfPrice.value : '',
          halfDiscountPrice: offerHalf ? form.halfDiscountPrice.value : '',
          dietType: form.dietType.value,
          isAvailable: form.isAvailable.checked,
        },
      });
      toast(data.message);
      setEditing(null);
      setErrors({});
      await loadDishes();
    } catch (error) {
      setErrors(errorFields(error));
      toast(error.message);
    }
  }

  async function removeDish() {
    try {
      const data = await api(`/api/owner/dishes/${removing.id}`, { method: 'DELETE' });
      toast(data.message);
      setRemoving(null);
      await loadDishes();
    } catch (error) {
      toast(error.message);
    }
  }

  function openDish(dish) {
    setErrors({});
    setOfferHalf(dish.halfPriceCents != null);
    setEditing(dish.id ? dishFormState(dish) : dish);
  }

  async function toggleAvailability(dish) {
    if (locked || pendingId) return;
    const next = !dish.isAvailable;
    setPendingId(dish.id);
    setResult((current) => current && ({
      ...current,
      items: current.items.map((item) => (item.id === dish.id ? { ...item, isAvailable: next } : item)),
    }));
    try {
      const data = await api(`/api/owner/dishes/${dish.id}/availability`, { method: 'POST', body: { isAvailable: next } });
      setResult((current) => current && ({
        ...current,
        items: current.items.map((item) => (item.id === dish.id ? data.dish : item)),
      }));
    } catch (error) {
      setResult((current) => current && ({
        ...current,
        items: current.items.map((item) => (item.id === dish.id ? { ...item, isAvailable: dish.isAvailable } : item)),
      }));
      toast(error.message);
    } finally {
      setPendingId('');
    }
  }

  async function move(dish, direction) {
    try {
      await api(`/api/owner/dishes/${dish.id}/move`, { method: 'POST', body: { direction } });
      await loadDishes();
    } catch (error) {
      toast(error.message);
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div><h1>Dishes</h1><p>Serial numbers follow display order and close up after a deletion. Database IDs never change.</p></div>
        <button className="btn" type="button" disabled={locked || categories.length === 0} onClick={() => openDish({ ...emptyDish, categoryId: categories[0]?.id || '' })}>Add dish</button>
      </div>
      {locked ? <Gate restaurant={restaurant}><span /></Gate> : null}
      {categories.length === 0 ? <Empty title="Add a category first" body="Dishes belong to a category." action={<Link className="btn" to="/owner/categories">Categories</Link>} /> : null}
      <form className="filters" onSubmit={(event) => { event.preventDefault(); setPage(1); setQuery(search.trim()); }}>
        <input className="input" placeholder="Search dishes" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search dishes" />
        <select className="select" aria-label="Category filter" value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setPage(1); }}>
          <option value="">All categories</option>
          {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
        <select className="select" aria-label="Availability" value={availability} onChange={(event) => { setAvailability(event.target.value); setPage(1); }}>
          <option value="">Any availability</option>
          <option value="available">Available</option>
          <option value="unavailable">Unavailable</option>
        </select>
        <select className="select" aria-label="Sort" value={`${sort}:${dir}`} onChange={(event) => { const [nextSort, nextDir] = event.target.value.split(':'); setSort(nextSort); setDir(nextDir); setPage(1); }}>
          <option value="display_order:asc">Serial number</option>
          <option value="name:asc">Name A–Z</option>
          <option value="price:asc">Price low–high</option>
          <option value="price:desc">Price high–low</option>
        </select>
        <button className="btn btn-secondary" type="submit">Search</button>
      </form>
      {!result ? <Spinner label="Loading dishes" /> : null}
      {result && result.items.length === 0 ? <Empty title="No dishes" body="Add the first dish to publish it on the QR menu." /> : null}
      {result && result.items.length > 0 ? (
        <>
          <div className="table-wrap">
            <table className="data cards">
              <thead>
                <tr><th>S.No</th><th>Dish</th><th>Category</th><th>Price</th><th>Type</th><th>Status</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {result.items.map((dish) => (
                  <tr key={dish.id}>
                    <td data-label="S.No"><strong>{dish.displayOrder}</strong></td>
                    <td data-label="Dish">
                      <strong>{dish.name}</strong>
                      {dish.description ? <div className="faint">{dish.description}</div> : null}
                    </td>
                    <td data-label="Category">{categories.find((category) => category.id === dish.categoryId)?.name || '—'}</td>
                    <td data-label="Price"><DishPrice dish={dish} symbol={symbol} /></td>
                    <td data-label="Type">{dish.dietType === 'veg' ? 'Veg' : 'Non-veg'}</td>
                    <td data-label="Status">
                      <AvailabilitySwitch available={dish.isAvailable} disabled={locked || pendingId === dish.id} dishName={dish.name} onToggle={() => toggleAvailability(dish)} />
                    </td>
                    <td data-label="Actions">
                      <div className="row-actions">
                        <button className="btn btn-ghost btn-sm" type="button" disabled={locked} onClick={() => move(dish, 'up')}>Up</button>
                        <button className="btn btn-ghost btn-sm" type="button" disabled={locked} onClick={() => move(dish, 'down')}>Down</button>
                        <button className="btn btn-secondary btn-sm" type="button" disabled={locked} onClick={() => openDish(dish)}>Edit</button>
                        <button className="btn btn-ghost btn-sm" type="button" disabled={locked} onClick={() => setRemoving(dish)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={result.page} totalPages={result.totalPages} onPage={setPage} />
        </>
      ) : null}
      {editing ? (
        <Modal title={editing.id ? 'Edit dish' : 'New dish'} onClose={() => setEditing(null)}>
          <form key={editing.id || 'new-dish'} onSubmit={save}>
            <Field label="Name" error={errors.name}><input name="name" defaultValue={editing.name} required /></Field>
            <Field label="Description" error={errors.description}><textarea name="description" defaultValue={editing.description || ''} /></Field>
            <Field label="Category" error={errors.categoryId}>
              <select name="categoryId" defaultValue={editing.categoryId}>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </Field>
            <label className="check">
              <input type="checkbox" checked={offerHalf} onChange={(event) => setOfferHalf(event.target.checked)} />
              Half and full portions
            </label>
            {offerHalf ? (
              <div className="grid-2">
                <Field label="Half price" error={errors.halfPrice}><input name="halfPrice" inputMode="decimal" defaultValue={editing.halfPrice} required /></Field>
                <Field label="Half discount" error={errors.halfDiscountPrice}><input name="halfDiscountPrice" inputMode="decimal" defaultValue={editing.halfDiscountPrice} /></Field>
              </div>
            ) : null}
            <div className="grid-2">
              <Field label={offerHalf ? 'Full price' : 'Price'} error={errors.price}><input name="price" inputMode="decimal" defaultValue={editing.price} required /></Field>
              <Field label={offerHalf ? 'Full discount' : 'Discount price'} error={errors.discountPrice}><input name="discountPrice" inputMode="decimal" defaultValue={editing.discountPrice} /></Field>
            </div>
            <Field label="Type" error={errors.dietType}>
              <select name="dietType" defaultValue={editing.dietType}>
                <option value="veg">Vegetarian</option>
                <option value="non_veg">Non-vegetarian</option>
              </select>
            </Field>
            <label className="check"><input name="isAvailable" type="checkbox" defaultChecked={editing.isAvailable !== false} /> Available</label>
            <div className="modal-actions">
              <button className="btn btn-secondary" type="button" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn" type="submit">Save dish</button>
            </div>
          </form>
        </Modal>
      ) : null}
      {removing ? (
        <Modal title="Delete dish" onClose={() => setRemoving(null)}>
          <p>Delete {removing.name}? The serial numbers of the remaining dishes will close up. The permanent ID is not reused.</p>
          <div className="modal-actions">
            <button className="btn btn-secondary" type="button" onClick={() => setRemoving(null)}>Cancel</button>
            <button className="btn" type="button" onClick={removeDish}>Delete</button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

export function OwnerQr() {
  const toast = useToast();
  const [data, setData] = useState(null);
  useEffect(() => { api('/api/owner/qr').then(setData).catch((error) => toast(error.message)); }, []);
  if (!data) return <Spinner label="Loading QR code" />;
  return (
    <div className="page">
      <div className="page-header no-print"><div><h1>QR code</h1><p>One code per restaurant. Menu edits do not require a new code.</p></div></div>
      {!data.ready ? (
        <Empty title="QR code is not ready" body="It is created automatically when the account is activated with a valid subscription." action={<Link className="btn" to="/owner/subscription">Subscription</Link>} />
      ) : (
        <section className="card print-sheet">
          <p className="kicker">Scanora</p>
          <p className="muted">Scan to view the menu</p>
          <h2>{data.restaurant.name}</h2>
          <div className="qr-frame"><img src="/api/owner/qr.png" alt={`QR code for ${data.restaurant.name}`} /></div>
          <p className="muted">{data.url}</p>
          <div className="row-actions no-print" style={{ justifyContent: 'center' }}>
            <a className="btn btn-sm" href="/api/owner/qr.png?download=1">Download PNG</a>
            <a className="btn btn-secondary btn-sm" href="/api/owner/qr.pdf">Download PDF</a>
            <button className="btn btn-secondary btn-sm" type="button" onClick={() => window.print()}>Print</button>
            <button className="btn btn-ghost btn-sm" type="button" onClick={async () => { await navigator.clipboard.writeText(data.url); toast('Menu link copied'); }}>Copy link</button>
            <a className="btn btn-ghost btn-sm" href={data.url} target="_blank" rel="noreferrer">Preview menu</a>
          </div>
        </section>
      )}
    </div>
  );
}

export function OwnerSubscription() {
  const toast = useToast();
  const { refresh } = useAuth();
  const [restaurant, setRestaurant] = useState(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  async function load() {
    const result = await api('/api/owner/subscription');
    setRestaurant(result.restaurant);
  }
  useEffect(() => { load().catch((err) => toast(err.message)); }, []);
  if (!restaurant) return <Spinner label="Loading subscription" />;

  async function redeem(event) {
    event.preventDefault();
    try {
      const result = await api('/api/owner/redeem', { method: 'POST', body: { code } });
      setRestaurant(result.restaurant);
      setCode('');
      setError('');
      toast(result.message);
      refresh();
    } catch (err) {
      setError(err.message);
      toast(err.message);
    }
  }

  return (
    <div className="page">
      <div className="page-header"><div><h1>Subscription</h1><p>Menu changes require a valid subscription. Expired data is kept.</p></div></div>
      <div className="stats">
        <div className="stat"><b style={{ fontSize: 18 }}>{restaurant.planLabel}</b><span>Plan</span></div>
        <div className="stat"><b style={{ fontSize: 18 }}>{STATUS_LABEL[restaurant.activationStatus]}</b><span>Status</span></div>
        <div className="stat"><b style={{ fontSize: 18 }}>{formatDate(restaurant.expiryDate)}</b><span>Expiry</span></div>
        <div className="stat"><b>{restaurant.remainingDays}</b><span>Days left</span></div>
      </div>
      <form className="card" onSubmit={redeem} style={{ marginTop: 16 }}>
        <h2>Redeem an activation token</h2>
        <p className="hint">Tokens are single use. A valid token approves the account, starts or extends validity, and creates the QR code if needed. If you still have time left, the new days are added to the current expiry.</p>
        <Field label="Token" error={error}><input value={code} onChange={(event) => setCode(event.target.value)} placeholder="MNTH-XXXX-XXXX-XXXX" autoCapitalize="characters" /></Field>
        <button className="btn" type="submit">Redeem token</button>
      </form>
      <section className="card">
        <h2>Renewal</h2>
        <p className="muted">Ask your platform administrator for a new demo, monthly, or yearly token, or ask them to extend the account manually. You do not need a new QR code after renewal.</p>
      </section>
    </div>
  );
}
