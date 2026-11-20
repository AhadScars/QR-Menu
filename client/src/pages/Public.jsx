import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, errorFields } from '../api.js';
import { Brand, DishPrice, Field, useAuth, useToast } from '../ui.jsx';

function MenuPreview() {
  return (
    <figure className="preview">
      <div className="phone" aria-hidden="true">
        <div className="phone-cover" />
        <div className="phone-logo">S</div>
        <div className="phone-sheet">
          <p className="phone-kicker">Sample</p>
          <p className="phone-name">Your restaurant</p>
          <p className="phone-meta">12 King Street</p>
          <div className="phone-tabs">
            <span className="on">Starters</span>
            <span>Mains</span>
            <span>Drinks</span>
          </div>
          <ul className="phone-dishes">
            <li>
              <span className="diet-mark" />
              <span><b>Garden plate</b><small>Greens, lemon, oil</small></span>
              <em>₹12</em>
            </li>
            <li>
              <span className="diet-mark" />
              <span><b>Tomato toast</b><small>Half · Full</small></span>
              <em>₹8</em>
            </li>
            <li className="out">
              <span className="diet-mark nonveg" />
              <span><b>Soup of the day</b><small>Sold out</small></span>
              <em>₹9</em>
            </li>
          </ul>
        </div>
      </div>
      <figcaption>What a guest sees after the scan.</figcaption>
    </figure>
  );
}

export function Landing() {
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    const previous = meta?.getAttribute('content');
    if (meta) meta.setAttribute('content', '#f4f1eb');
    return () => {
      if (meta && previous) meta.setAttribute('content', previous);
    };
  }, []);

  return (
    <div className="marketing">
      <header className="top-nav">
        <div className="nav-inner">
          <Brand />
          <nav className="nav-actions" aria-label="Account">
            <Link className="text-link" to="/login">Owner login</Link>
            <Link className="btn btn-sm" to="/register">Register</Link>
          </nav>
        </div>
      </header>

      <main className="home">
        <section className="hero">
          <div className="hero-copy">
            <p className="kicker">Scanora</p>
            <h1>Your menu, on every table.</h1>
            <p className="lede">Change a price and the next scan already shows it. One QR, printed once. Guests need no app and no account.</p>
            <div className="hero-actions">
              <Link className="btn" to="/register">Create a restaurant</Link>
              <Link className="text-link" to="/login">Owner login</Link>
            </div>
          </div>
          <MenuPreview />
        </section>

        <section className="facts" aria-label="At a glance">
          <article>
            <p className="kicker">01</p>
            <h2>One code</h2>
            <p>Print it once. Price and dish changes appear on the same QR.</p>
          </article>
          <article>
            <p className="kicker">02</p>
            <h2>Three plans</h2>
            <p>A 3-day demo, 30 days monthly, or 365 days yearly.</p>
          </article>
          <article>
            <p className="kicker">03</p>
            <h2>No guest login</h2>
            <p>Anyone with the code opens the menu in the phone browser.</p>
          </article>
        </section>

        <section className="section">
          <div className="section-intro">
            <h2>Three roles. Nothing extra.</h2>
            <p className="lede">Each person sees only what that role is allowed to do.</p>
          </div>
          <div className="feature-grid">
            <article>
              <h3>Super admin</h3>
              <p>Approve or reject a restaurant, activate or block it, assign a plan, extend validity, reset a password, and issue one-time tokens.</p>
            </article>
            <article>
              <h3>Restaurant owner</h3>
              <p>One restaurant: name, logo, cover, categories, and dishes. A new account stays pending until an admin approves it or a token is redeemed.</p>
            </article>
            <article>
              <h3>Guest</h3>
              <p>Scans the card on the table. The menu opens with the restaurant, then dishes by category, with prices and anything sold out.</p>
            </article>
          </div>
        </section>

        <section className="section">
          <div className="section-intro">
            <h2>Live in four steps.</h2>
          </div>
          <ol className="steps">
            <li>
              <h3>Register</h3>
              <p>Choose a username, restaurant name, and password. The account waits until it is approved.</p>
            </li>
            <li>
              <h3>Activate</h3>
              <p>An admin assigns a plan, or the owner redeems a single-use token. The QR is created then.</p>
            </li>
            <li>
              <h3>Print</h3>
              <p>Download a PNG or a PDF, or print from the browser, and place it on the table.</p>
            </li>
            <li>
              <h3>Serve</h3>
              <p>Add categories and dishes. Every edit is on the public menu immediately. The printed code stays.</p>
            </li>
          </ol>
        </section>

        <section className="section">
          <div className="section-intro">
            <h2>A phone menu. A simple desk.</h2>
            <p className="lede">Open the camera, scan, and scroll. Nothing to install.</p>
          </div>
          <div className="split-panels">
            <article>
              <h3>Guest</h3>
              <ul className="quiet-list">
                <li>Logo, cover, name, description, address, and phone at the top.</li>
                <li>Category tabs stay in place. Empty categories stay hidden.</li>
                <li>Name, description, full price, optional half portion, and diet.</li>
                <li>A sold-out dish stays listed and marked.</li>
              </ul>
            </article>
            <article>
              <h3>Owner</h3>
              <ul className="quiet-list">
                <li>Profile, currency symbol, logo, and cover image.</li>
                <li>Categories with order, and a hidden or visible flag.</li>
                <li>Search, filter, sort, and a one-tap sold-out switch.</li>
                <li>QR preview, menu link, PNG, and PDF. Redeem a token to extend.</li>
              </ul>
              <p className="aside-note">Visible dish numbers run 1, 2, 3. Deleting one closes the gap. A category that still has dishes cannot be removed until those dishes move.</p>
            </article>
          </div>
        </section>

        <section className="section">
          <div className="section-intro">
            <h2>Plans</h2>
            <p className="lede">A token works once. Days left are added to the current end date. If the plan has already ended, the new period starts today. Dishes stay stored either way.</p>
          </div>
          <div className="plan-grid">
            <article className="plan">
              <p className="kicker">Demo</p>
              <b>3 days</b>
              <p>A short trial so a restaurant can publish a menu and print a code.</p>
            </article>
            <article className="plan">
              <p className="kicker">Monthly</p>
              <b>30 days</b>
              <p>A month of edits, a public menu, and the same QR on the table.</p>
            </article>
            <article className="plan featured">
              <p className="kicker">Yearly</p>
              <b>365 days</b>
              <p>A full year on one code. Renew before the end and the days stack.</p>
            </article>
          </div>
        </section>

        <section className="section">
          <div className="section-intro">
            <h2>Questions</h2>
          </div>
          <div className="faq">
            <details>
              <summary>Does the QR change when a dish changes?</summary>
              <p>No. The code points at the restaurant’s menu address. Prices, names, and availability update on that page, so the printout on the table can stay.</p>
            </details>
            <details>
              <summary>What happens when a plan ends?</summary>
              <p>Categories, dishes, and the QR stay in the account. The public page follows the platform setting: hide the menu, show an expiry message, or leave it readable. The owner can still sign in and renew.</p>
            </details>
            <details>
              <summary>Can one owner open another restaurant’s menu editor?</summary>
              <p>No. Each owner session is tied to one restaurant. Requests for another restaurant’s dishes or categories are refused.</p>
            </details>
            <details>
              <summary>Do guests create an account?</summary>
              <p>No. The public menu has no login. The only people who sign in are the super admin and the restaurant owner.</p>
            </details>
          </div>
        </section>

        <section className="closing">
          <div>
            <h2>Put Scanora on the table.</h2>
            <p>Register the restaurant, activate a plan, and print one code. The menu can change every service after that.</p>
          </div>
          <Link className="btn" to="/register">Create a restaurant</Link>
        </section>
      </main>

      <footer className="site-footer">
        <div className="nav-inner">
          <span>Powered by DigiHub Solutions</span>
          <Link to="/admin/login">Administrator</Link>
        </div>
      </footer>
    </div>
  );
}

function AuthLayout({ title, lede, children, footer }) {
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <Brand />
        <h1>{title}</h1>
        <p className="lede">{lede}</p>
        {children}
        <p className="hint" style={{ marginTop: 16 }}>{footer}</p>
      </div>
    </div>
  );
}

export function Register() {
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState({ username: '', restaurantName: '', password: '', confirmPassword: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const result = await api('/api/auth/register', { method: 'POST', body: form });
      toast(result.message);
      navigate('/login');
    } catch (error) {
      setErrors(errorFields(error));
      toast(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Register your restaurant" lede="After signup the account stays pending until it is approved or you redeem an activation token." footer={<><Link to="/login">Already registered? Sign in</Link></>}>
      <form onSubmit={submit}>
        <Field label="Username" error={errors.username}><input autoComplete="username" value={form.username} onChange={set('username')} required /></Field>
        <Field label="Restaurant name" error={errors.restaurantName}><input value={form.restaurantName} onChange={set('restaurantName')} required /></Field>
        <Field label="Password" error={errors.password}><input type="password" autoComplete="new-password" value={form.password} onChange={set('password')} required /></Field>
        <Field label="Confirm password" error={errors.confirmPassword}><input type="password" autoComplete="new-password" value={form.confirmPassword} onChange={set('confirmPassword')} required /></Field>
        <button className="btn btn-full" type="submit" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
      </form>
    </AuthLayout>
  );
}

export function Login({ portal = 'owner' }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { setUser } = useAuth();
  const [form, setForm] = useState({ username: '', password: '' });
  const [busy, setBusy] = useState(false);
  const admin = portal === 'admin';

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api('/api/auth/login', { method: 'POST', body: { ...form, portal } });
      setUser(result.user);
      navigate(admin ? '/admin' : '/owner');
    } catch (error) {
      toast(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title={admin ? 'Super admin' : 'Owner sign in'}
      lede={admin ? 'Manage restaurants, tokens, and subscription rules.' : 'Manage your menu, QR code, and subscription.'}
      footer={admin ? <Link to="/login">Restaurant owner login</Link> : <><Link to="/register">Create an account</Link> · <Link to="/admin/login">Admin</Link></>}
    >
      <form onSubmit={submit}>
        <Field label="Username"><input autoComplete="username" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} required /></Field>
        <Field label="Password"><input type="password" autoComplete="current-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required /></Field>
        <button className="btn btn-full" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </AuthLayout>
  );
}

export function PublicMenu() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [active, setActive] = useState('');

  useEffect(() => {
    let ignore = false;
    api(`/api/public/menu/${slug}`)
      .then((payload) => { if (!ignore) { setData(payload); setActive(payload.categories?.[0]?.id || ''); } })
      .catch((err) => { if (!ignore) setError(err.message); });
    return () => { ignore = true; };
  }, [slug]);

  useEffect(() => {
    if (!data?.categories?.length) return undefined;
    const nodes = data.categories.map((category) => document.getElementById(`section-${category.id}`)).filter(Boolean);
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) setActive(visible.target.id.replace('section-', ''));
    }, { rootMargin: '-20% 0px -65% 0px', threshold: [0.1, 0.4] });
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [data]);

  useEffect(() => {
    const tab = document.querySelector(`[data-tab="${active}"]`);
    tab?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [active]);

  if (error) {
    return <div className="menu-page"><div className="notice"><Mark /><h1>Menu not found</h1><p className="muted">{error}</p></div></div>;
  }
  if (!data) return <div className="menu-page"><div className="center"><div className="spinner" /><span>Loading menu</span></div></div>;

  const restaurant = data.restaurant;
  const blockedView = data.state === 'unavailable' || data.state === 'hidden' || data.state === 'expired';

  return (
    <div className="menu-page">
      <article className="menu-sheet">
        {restaurant.coverUrl ? <img className="menu-cover" src={restaurant.coverUrl} alt="" /> : <div className="menu-cover placeholder" />}
        <header className="menu-identity">
          {restaurant.logoUrl
            ? <img className="menu-logo" src={restaurant.logoUrl} alt="" />
            : <div className="menu-logo" aria-hidden="true">{restaurant.name.slice(0, 1).toUpperCase()}</div>}
          <h1>{restaurant.name}</h1>
          {restaurant.description ? <p className="menu-meta">{restaurant.description}</p> : null}
          {restaurant.address ? <p className="menu-meta">{restaurant.address}</p> : null}
          {restaurant.phone ? <p className="menu-meta">{restaurant.phone}</p> : null}
        </header>
        {blockedView ? (
          <div className="notice">
            <h2>{data.state === 'expired' ? 'Subscription expired' : 'Menu unavailable'}</h2>
            <p className="muted">{data.message}</p>
          </div>
        ) : (
          <>
            {data.state === 'readonly' ? <div className="banner" style={{ margin: 16 }}><strong>Read only</strong><p>{data.message}</p></div> : null}
            {data.categories.length === 0 ? (
              <div className="notice"><h2>Menu coming soon</h2><p className="muted">This restaurant has not published any dishes yet.</p></div>
            ) : (
              <>
                <nav className="menu-tabs" aria-label="Categories">
                  {data.categories.map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      data-tab={category.id}
                      className={active === category.id ? 'menu-tab active' : 'menu-tab'}
                      onClick={() => {
                        setActive(category.id);
                        document.getElementById(`section-${category.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }}
                    >
                      {category.name}
                    </button>
                  ))}
                </nav>
                {data.categories.map((category) => (
                  <section className="menu-section" id={`section-${category.id}`} key={category.id}>
                    <h2>{category.name}</h2>
                    {category.description ? <p className="section-copy">{category.description}</p> : null}
                    {category.dishes.map((dish) => (
                      <article className={dish.isAvailable ? 'dish' : 'dish unavailable'} key={dish.id}>
                        <div className="dish-top">
                          <h3>{dish.name}</h3>
                          <DishPrice dish={dish} symbol={restaurant.currencySymbol} />
                        </div>
                        <p className="dish-meta">
                          {dish.dietType === 'veg' ? 'Veg' : 'Non-veg'}
                          {!dish.isAvailable ? ' · Unavailable' : ''}
                        </p>
                        {dish.description ? <p>{dish.description}</p> : null}
                      </article>
                    ))}
                  </section>
                ))}
              </>
            )}
          </>
        )}
        <footer className="menu-footer">Powered by DigiHub Solutions</footer>
      </article>
    </div>
  );
}
