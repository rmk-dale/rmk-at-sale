'use client';

import { useEffect, useState } from 'react';

interface AdminOrder {
  _id: string;
  buyerEmail: string;
  items: { itemCode: string; description: string; quantity: number; price: number }[];
  total: number;
  status: 'received' | 'fulfilled' | 'cancelled';
  createdAt: string;
}

const STATUS_STYLES: Record<AdminOrder['status'], string> = {
  received: 'bg-blue-50 text-blue-600',
  fulfilled: 'bg-emerald-50 text-emerald-600',
  cancelled: 'bg-zinc-100 text-zinc-500',
};

const FILTERS: { label: string; value: '' | AdminOrder['status'] }[] = [
  { label: 'All', value: '' },
  { label: 'Received', value: 'received' },
  { label: 'Fulfilled', value: 'fulfilled' },
  { label: 'Cancelled', value: 'cancelled' },
];

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'' | AdminOrder['status']>('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const load = (status: '' | AdminOrder['status']) => {
    setLoading(true);
    fetch(`/api/admin/orders${status ? `?status=${status}` : ''}`)
      .then((res) => res.json())
      .then((data) => {
        setOrders(Array.isArray(data) ? data : []);
        setLoading(false);
      });
  };

  useEffect(() => load(filter), [filter]);

  const updateStatus = async (orderId: string, status: AdminOrder['status']) => {
    setUpdatingId(orderId);
    try {
      const res = await fetch(`/api/admin/orders/${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) load(filter);
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold text-zinc-900 mb-6">Orders</h1>

      <div className="flex gap-2 mb-6">
        {FILTERS.map((f) => (
          <button
            key={f.label}
            onClick={() => setFilter(f.value)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              filter === f.value ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-zinc-500 text-sm">Loading orders…</p>
      ) : orders.length === 0 ? (
        <div className="text-center py-24 bg-surface rounded-2xl border border-border">
          <p className="text-zinc-500">No orders yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map((order) => (
            <div key={order._id} className="bg-surface border border-border rounded-2xl p-6">
              <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
                <div>
                  <p className="text-zinc-900 font-medium">{order.buyerEmail}</p>
                  <p className="text-zinc-500 text-xs">{new Date(order.createdAt).toLocaleString()}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[order.status]}`}>
                    {order.status}
                  </span>
                  <span className="text-zinc-900 font-semibold">${order.total.toFixed(2)}</span>
                </div>
              </div>

              <ul className="text-sm text-zinc-600 mb-4 space-y-1">
                {order.items.map((item, i) => (
                  <li key={i}>
                    {item.quantity}x {item.description}{' '}
                    <span className="text-zinc-400 font-mono text-xs">({item.itemCode})</span> — $
                    {(item.price * item.quantity).toFixed(2)}
                  </li>
                ))}
              </ul>

              <div className="flex gap-2">
                {order.status !== 'fulfilled' && (
                  <button
                    disabled={updatingId === order._id}
                    onClick={() => updateStatus(order._id, 'fulfilled')}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                  >
                    Mark fulfilled
                  </button>
                )}
                {order.status !== 'cancelled' && (
                  <button
                    disabled={updatingId === order._id}
                    onClick={() => updateStatus(order._id, 'cancelled')}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg bg-zinc-100 text-zinc-600 hover:bg-zinc-200 disabled:opacity-50 transition-colors"
                  >
                    Cancel (restock)
                  </button>
                )}
                {order.status !== 'received' && (
                  <button
                    disabled={updatingId === order._id}
                    onClick={() => updateStatus(order._id, 'received')}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg bg-zinc-100 text-zinc-600 hover:bg-zinc-200 disabled:opacity-50 transition-colors"
                  >
                    Reopen
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
