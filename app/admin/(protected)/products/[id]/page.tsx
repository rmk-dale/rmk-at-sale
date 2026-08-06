'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import PhotoPicker from '@/components/admin/PhotoPicker';

interface AdminProduct {
  _id: string;
  description: string;
  price: number;
  stock: number;
  image: string;
  hoverImage?: string;
}

export default function EditProductPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [image, setImage] = useState('');
  const [hoverImage, setHoverImage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/admin/products')
      .then((res) => res.json())
      .then((data: AdminProduct[]) => {
        const product = data.find((p) => p._id === id);
        if (!product) {
          setNotFound(true);
        } else {
          setDescription(product.description);
          setPrice(String(product.price));
          setStock(String(product.stock));
          setImage(product.image || '');
          setHoverImage(product.hoverImage || '');
        }
        setLoading(false);
      });
  }, [id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!image) {
      setError('Choose a main photo before saving.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/admin/products/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: description.trim(),
          price: Number(price),
          stock: Number(stock),
          image,
          hoverImage: hoverImage || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save changes');
      router.push('/admin');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-zinc-500 text-sm">Loading…</p>;

  if (notFound) {
    return (
      <div>
        <p className="text-zinc-500 mb-6">Item {id} not found.</p>
        <Link href="/admin" className="text-zinc-900 font-medium">Back to inventory</Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <Link href="/admin" className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 mb-6">
        <ArrowLeft className="w-4 h-4" />
        Back to inventory
      </Link>

      <h1 className="text-2xl font-semibold text-zinc-900 mb-1">Edit item</h1>
      <p className="text-sm text-zinc-500 font-mono mb-8">{id}</p>

      <form onSubmit={handleSubmit} className="space-y-6 bg-surface border border-border rounded-2xl p-8">
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-zinc-600 mb-2">Regular price</label>
            <input
              required
              type="number"
              min="0"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-600 mb-2">Inventory</label>
            <input
              required
              type="number"
              min="0"
              step="1"
              value={stock}
              onChange={(e) => setStock(e.target.value)}
              className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-600 mb-2">Description</label>
          <textarea
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-600 mb-2">Photo</label>
          <PhotoPicker image={image} hoverImage={hoverImage} onChangeImage={setImage} onChangeHoverImage={setHoverImage} />
        </div>

        {error && <p className="text-red-500 text-sm">{error}</p>}

        <button
          disabled={saving}
          type="submit"
          className="w-full bg-zinc-900 text-white py-3 rounded-xl font-medium disabled:opacity-50 hover:bg-zinc-700 transition-colors"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </form>
    </div>
  );
}
