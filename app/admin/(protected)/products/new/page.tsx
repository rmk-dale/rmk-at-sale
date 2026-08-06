'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import PhotoPicker from '@/components/admin/PhotoPicker';

export default function NewProductPage() {
  const router = useRouter();
  const [itemCode, setItemCode] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [image, setImage] = useState('');
  const [hoverImage, setHoverImage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!image) {
      setError('Choose a main photo before saving.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/admin/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemCode: itemCode.trim(),
          description: description.trim(),
          price: Number(price),
          stock: Number(stock),
          image,
          hoverImage: hoverImage || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add item');
      router.push('/admin');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <Link href="/admin" className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 mb-6">
        <ArrowLeft className="w-4 h-4" />
        Back to inventory
      </Link>

      <h1 className="text-2xl font-semibold text-zinc-900 mb-8">Add item</h1>

      <form onSubmit={handleSubmit} className="space-y-6 bg-surface border border-border rounded-2xl p-8">
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-zinc-600 mb-2">Item Code</label>
            <input
              required
              value={itemCode}
              onChange={(e) => setItemCode(e.target.value)}
              placeholder="AT88G01001"
              className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-zinc-900 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
            />
          </div>
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
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-600 mb-2">Description</label>
          <textarea
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="AIRCONIC SPINNER 55/20 TSA SPORTY BLUE"
            className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900"
          />
        </div>

        <div className="sm:w-48">
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
          {saving ? 'Saving…' : 'Add item'}
        </button>
      </form>
    </div>
  );
}
