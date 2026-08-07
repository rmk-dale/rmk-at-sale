"use client";

import { useState } from "react";
import { X } from "lucide-react";

interface SizeTagInputProps {
  sizes: string[];
  onChange: (sizes: string[]) => void;
}

export default function SizeTagInput({ sizes, onChange }: SizeTagInputProps) {
  const [draft, setDraft] = useState("");

  const addSize = () => {
    const value = draft.trim();
    if (!value) return;
    if (sizes.some((s) => s.toLowerCase() === value.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...sizes, value]);
    setDraft("");
  };

  const removeSize = (value: string) => {
    onChange(sizes.filter((s) => s !== value));
  };

  return (
    <div>
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              addSize();
            }
          }}
          placeholder="e.g. 55cm"
          className="flex-1 bg-white border border-border rounded-xl px-4 py-2.5 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900"
        />
        <button
          type="button"
          onClick={addSize}
          className="px-4 py-2.5 bg-zinc-100 text-zinc-700 rounded-xl text-sm font-medium hover:bg-zinc-200 transition-colors"
        >
          Add
        </button>
      </div>
      {sizes.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3">
          {sizes.map((s) => (
            <span
              key={s}
              className="flex items-center gap-1.5 bg-zinc-100 text-zinc-700 text-sm rounded-full pl-3 pr-1.5 py-1"
            >
              {s}
              <button
                type="button"
                onClick={() => removeSize(s)}
                className="p-0.5 hover:text-red-500 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
