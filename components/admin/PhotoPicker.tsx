"use client";

import { ImageOff } from "lucide-react";
import { usePhotoLibrary, type Photo } from "./usePhotoLibrary";
import PhotoLibraryBrowser from "./PhotoLibraryBrowser";

interface PhotoPickerProps {
  image: string;
  hoverImage: string;
  onChangeImage: (path: string) => void;
  onChangeHoverImage: (path: string) => void;
}

/**
 * The colour-level picker: assigns a main and a hover photo for one colour.
 *
 * No size context here — a colour spans every size — so the library is grouped
 * by folder with no "suggested" heading. The folder badge on each tile and the
 * folder chips are what make small/medium/large legible.
 */
export default function PhotoPicker({
  image,
  hoverImage,
  onChangeImage,
  onChangeHoverImage,
}: PhotoPickerProps) {
  // Shared with every PhotoField on the page, so the form issues one request
  // for the library rather than one per picker.
  const { photos, loading } = usePhotoLibrary();

  if (loading) {
    return (
      <p className="text-sm text-zinc-500">Loading photos already in the repo…</p>
    );
  }

  if (photos.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        No image files found under{" "}
        <code className="text-xs bg-zinc-100 px-1 py-0.5 rounded">
          public/items/
        </code>{" "}
        (including its <code className="text-xs bg-zinc-100 px-1 py-0.5 rounded">small/</code>,{" "}
        <code className="text-xs bg-zinc-100 px-1 py-0.5 rounded">medium/</code> and{" "}
        <code className="text-xs bg-zinc-100 px-1 py-0.5 rounded">large/</code>{" "}
        folders). Add a file there and deploy before it shows up here.
      </p>
    );
  }

  const stateOf = (photo: Photo) => {
    if (image === photo.path) return "main" as const;
    if (hoverImage === photo.path) return "hover" as const;
    return null;
  };

  return (
    <>
      <PhotoLibraryBrowser
        photos={photos}
        columns="grid-cols-4 sm:grid-cols-6"
        stateOf={stateOf}
        renderTileActions={(photo) => {
          const isMain = image === photo.path;
          const isHover = hoverImage === photo.path;
          return (
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => onChangeImage(photo.path)}
                aria-pressed={isMain}
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
                aria-pressed={isHover}
                className={`flex-1 text-[10px] py-1 rounded-md font-medium transition-colors ${
                  isHover
                    ? "bg-emerald-600 text-white"
                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                }`}
              >
                Hover
              </button>
            </div>
          );
        }}
      >
        <p className="text-xs text-zinc-500 mb-2.5">
          Choose an existing photo from{" "}
          <code className="text-xs bg-zinc-100 px-1 py-0.5 rounded">
            public/items/
          </code>
          . The corner badge is the folder it&apos;s filed under —{" "}
          <span className="font-medium">S</span>mall,{" "}
          <span className="font-medium">M</span>edium,{" "}
          <span className="font-medium">L</span>arge. Need a brand-new photo? It
          has to be added to the codebase and deployed first — this only assigns
          what&apos;s already there.
        </p>
      </PhotoLibraryBrowser>

      {!image && (
        <p className="flex items-center gap-1.5 text-xs text-amber-600 mt-3">
          <ImageOff className="w-3.5 h-3.5" />
          Select a main photo before saving.
        </p>
      )}
    </>
  );
}
