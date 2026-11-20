export class ApiError extends Error {
  constructor(message, status, fields) {
    super(message);
    this.status = status;
    this.fields = fields || {};
  }
}

export async function api(path, { method = 'GET', body, form } = {}) {
  const options = { method, credentials: 'include' };
  if (form) {
    options.body = form;
  } else if (body !== undefined) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(body);
  }
  const response = await fetch(path, options);
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json() : null;
  if (response.status === 401 && !path.startsWith('/api/auth/login')) {
    window.dispatchEvent(new Event('auth:lost'));
  }
  if (!response.ok) {
    throw new ApiError(data?.error || 'Request failed', response.status, data?.fields);
  }
  return data;
}

export function formatMoney(cents, symbol = '₹') {
  if (cents == null) return '—';
  return `${symbol}${(Number(cents) / 100).toFixed(2)}`;
}

export function formatDate(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatWhen(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const STATUS_LABEL = {
  pending: 'Pending approval',
  rejected: 'Rejected',
  active: 'Active',
  inactive: 'Inactive',
  deactivated: 'Deactivated',
  blocked: 'Blocked',
  expired: 'Expired',
  no_plan: 'No plan',
};

export function errorFields(error) {
  return error?.fields || {};
}
