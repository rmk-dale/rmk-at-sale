"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ImageOff } from "lucide-react";

interface Photo {
  filename: string;
  path: string;
}

interface PhotoPickerProps {
  image: string;
  hoverImage: string;
  onChangeImage: (path: string) => void;
  onChangeHoverImage: (path: string) => void;
}

export default function PhotoPicker({
  image,
  hoverImage,
  onChangeImage,
  onChangeHoverImage,
}: PhotoPickerProps) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/photos")
      .then((res) => res.json())
      .then((data) => {
        setPhotos(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <p className="text-sm text-zinc-500">
        Loading photos already in the repo…
      </p>
    );
  }

  if (photos.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        No image files found in{" "}
        <code className="text-xs bg-zinc-100 px-1 py-0.5 rounded">
          public/items/
        </code>
        . Add a file there and deploy before it shows up here.
      </p>
    );
  }

  return (
    <div>
      <p className="text-xs text-zinc-500 mb-3">
        Choose an existing photo from{" "}
        <code className="text-xs bg-zinc-100 px-1 py-0.5 rounded">
          public/items/
        </code>
        . Need a brand-new photo? It has to be added to the codebase and
        deployed first — this only assigns what&apos;s already there.
      </p>
      <div className="grid grid-cols-4 sm:grid-cols-6 gap-3">
        {photos.map((photo) => {
          const isMain = image === photo.path;
          const isHover = hoverImage === photo.path;
          return (
            <div key={photo.path} className="flex flex-col gap-1.5">
              <div
                className={`aspect-square relative rounded-xl overflow-hidden border-2 transition-colors ${
                  isMain
                    ? "border-zinc-900"
                    : isHover
                      ? "border-emerald-500"
                      : "border-border"
                }`}
              >
                <Image
                  src={photo.path}
                  alt={photo.filename}
                  fill
                  sizes="120px"
                  className="object-cover"
                />
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => onChangeImage(photo.path)}
                  className={`flex-1 text-[10px] py-1 rounded-md font-medium transition-colors ${
                    isMain
                      ? "bg-zinc-900 text-white"
                      : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                  }`}
                >
                  Main
                </button>
                <button
                  type="button"
                  onClick={() => onChangeHoverImage(isHover ? "" : photo.path)}
                  className={`flex-1 text-[10px] py-1 rounded-md font-medium transition-colors ${
                    isHover
                      ? "bg-emerald-600 text-white"
                      : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                  }`}
                >
                  Hover
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {!image && (
        <p className="flex items-center gap-1.5 text-xs text-amber-600 mt-3">
          <ImageOff className="w-3.5 h-3.5" />
          Select a main photo before saving.
        </p>
      )}
    </div>
  );
}
