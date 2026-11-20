import React from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Shell, Spinner, useAuth } from './ui.jsx';
import { Landing, Login, PublicMenu, Register } from './pages/Public.jsx';
import { AdminAudit, AdminDashboard, AdminRestaurantDetail, AdminRestaurants, AdminSettings, AdminTokens } from './pages/Admin.jsx';
import { OwnerCategories, OwnerDashboard, OwnerDishes, OwnerProfile, OwnerQr, OwnerSubscription } from './pages/Owner.jsx';

function Require({ role, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner label="Checking session" />;
  if (!user) {
    const next = role === 'super_admin' ? '/admin/login' : '/login';
    return <Navigate to={next} replace state={{ from: location.pathname }} />;
  }
  if (user.role !== role) return <Navigate to={user.role === 'super_admin' ? '/admin' : '/owner'} replace />;
  return children;
}

const adminNav = [
  { to: '/admin', label: 'Overview', end: true },
  { to: '/admin/restaurants', label: 'Restaurants' },
  { to: '/admin/tokens', label: 'Activation tokens' },
  { to: '/admin/audit', label: 'Audit log' },
  { to: '/admin/settings', label: 'Settings' },
];

const ownerNav = [
  { to: '/owner', label: 'Overview', end: true },
  { to: '/owner/profile', label: 'Profile' },
  { to: '/owner/categories', label: 'Categories' },
  { to: '/owner/dishes', label: 'Dishes' },
  { to: '/owner/qr', label: 'QR code' },
  { to: '/owner/subscription', label: 'Subscription' },
];

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/register" element={<Register />} />
      <Route path="/login" element={<Login portal="owner" />} />
      <Route path="/admin/login" element={<Login portal="admin" />} />
      <Route path="/menu/:slug" element={<PublicMenu />} />
      <Route path="/admin" element={<Require role="super_admin"><Shell home="/admin" items={adminNav} /></Require>}>
        <Route index element={<AdminDashboard />} />
        <Route path="restaurants" element={<AdminRestaurants />} />
        <Route path="restaurants/:id" element={<AdminRestaurantDetail />} />
        <Route path="tokens" element={<AdminTokens />} />
        <Route path="audit" element={<AdminAudit />} />
        <Route path="settings" element={<AdminSettings />} />
      </Route>
      <Route path="/owner" element={<Require role="owner"><Shell home="/owner" items={ownerNav} /></Require>}>
        <Route index element={<OwnerDashboard />} />
        <Route path="profile" element={<OwnerProfile />} />
        <Route path="categories" element={<OwnerCategories />} />
        <Route path="dishes" element={<OwnerDishes />} />
        <Route path="qr" element={<OwnerQr />} />
        <Route path="subscription" element={<OwnerSubscription />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
