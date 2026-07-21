"use client";

import { useState, useEffect, useCallback } from "react";
import BottomNav from "../components/BottomNav";
import PageHeader from "@/components/PageHeader";
import { useLang } from "@/lib/useLang";
import { fetchPublicGraphQL } from "@/lib/publicRasayeshClient";

const RASAYESH_BASE = "https://api.rasayesh.com/";
const PER_PAGE = 20;
const EVENT_ORIGIN = "https://2025.iphexpo.com";

const EVENT_GALLERY_CATEGORIES_QUERY = `
  query EventGalleryCategories($mainEventId: Int) {
    eventGalleryCategories(mainEventId: $mainEventId, all: true) {
      id
      name_fa
      name_en
    }
  }
`;

const EVENT_GALLERY_SUBCATEGORIES_QUERY = `
  query EventGallerySubCategories($categoryId: Int) {
    eventGallerySubCategories(categoryId: $categoryId, all: true) {
      id
      name_fa
      name_en
    }
  }
`;

const EVENT_GALLERY_PICTURES_QUERY = `
  query EventGalleryPictures($id: Int!, $page: Int) {
    eventGalleryPictures(subCategoryId: $id, page: $page, rowsPerPage: 20, orderBy: "id", order: "asc") {
      id
      picture
      sub_category_id
    }
  }
`;

function picUrl(picture, size) {
  if (!picture) return null;
  const fmt = picture.jpg || picture.webp;
  if (!fmt) return null;
  return RASAYESH_BASE + (fmt[size] || fmt["640"] || fmt["320"] || Object.values(fmt)[0]);
}

function Lightbox({ photos, index, onClose, onPrev, onNext }) {
  const photo = photos[index];

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") onPrev();
      if (e.key === "ArrowRight") onNext();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onPrev, onNext]);

  if (!photo) return null;
  const src = picUrl(photo.picture, "1280");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.93)" }}
      onClick={onClose}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        style={{
          maxWidth: "92vw",
          maxHeight: "84vh",
          objectFit: "contain",
          borderRadius: 12,
          display: "block",
        }}
        onClick={(e) => e.stopPropagation()}
      />

      {/* Close */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center rounded-full text-base font-bold"
        style={{ background: "rgba(255,255,255,0.18)", color: "#fff" }}
        aria-label="close"
      >
        ✕
      </button>

      {/* Prev (physically left) */}
      {index > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); onPrev(); }}
          className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full text-xl"
          style={{ background: "rgba(255,255,255,0.18)", color: "#fff" }}
          aria-label="previous"
        >
          ‹
        </button>
      )}

      {/* Next (physically right) */}
      {index < photos.length - 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); onNext(); }}
          className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full text-xl"
          style={{ background: "rgba(255,255,255,0.18)", color: "#fff" }}
          aria-label="next"
        >
          ›
        </button>
      )}

      {/* Counter */}
      <div
        className="absolute bottom-5 left-1/2 -translate-x-1/2 text-xs px-3 py-1 rounded-full"
        style={{ background: "rgba(0,0,0,0.55)", color: "rgba(255,255,255,0.75)" }}
      >
        {index + 1} / {photos.length}
      </div>
    </div>
  );
}

export default function GalleryClient({ title, subtitle, title_en, subtitle_en, isHomeContext = false }) {
  const { lang, isRTL } = useLang();

  const [categories, setCategories] = useState([]);
  const [activeCatId, setActiveCatId] = useState(null);
  const [subCategories, setSubCategories] = useState([]);
  const [activeSubId, setActiveSubId] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [catLoading, setCatLoading] = useState(true);
  const [subLoading, setSubLoading] = useState(false);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(null);

  const displayName = (item) =>
    lang === "en" && item.name_en ? item.name_en : item.name_fa;

  // Load categories once
  useEffect(() => {
    fetchPublicGraphQL(EVENT_GALLERY_CATEGORIES_QUERY, { mainEventId: 1 }, EVENT_ORIGIN)
      .then((result) => {
        const cats = result.data?.eventGalleryCategories ?? [];
        setCategories(cats);
        if (cats.length > 0) setActiveCatId(cats[cats.length - 1].id);
      })
      .catch(() => {})
      .finally(() => setCatLoading(false));
  }, []);

  // Load sub-categories when category changes
  useEffect(() => {
    if (!activeCatId) return;
    setSubLoading(true);
    setSubCategories([]);
    setActiveSubId(null);
    setPhotos([]);
    setHasMore(false);
    fetchPublicGraphQL(EVENT_GALLERY_SUBCATEGORIES_QUERY, { categoryId: activeCatId }, EVENT_ORIGIN)
      .then((result) => {
        const subs = result.data?.eventGallerySubCategories ?? [];
        setSubCategories(subs);
        if (subs.length > 0) setActiveSubId(subs[0].id);
      })
      .catch(() => {})
      .finally(() => setSubLoading(false));
  }, [activeCatId]);

  // Load photos when sub-category changes
  useEffect(() => {
    if (!activeSubId) return;
    setPhotosLoading(true);
    setPhotos([]);
    setPage(1);
    setHasMore(false);
    fetchPublicGraphQL(EVENT_GALLERY_PICTURES_QUERY, { id: activeSubId, page: 1 }, EVENT_ORIGIN)
      .then((result) => {
        const pics = result.data?.eventGalleryPictures ?? [];
        setPhotos(pics);
        setHasMore(pics.length === PER_PAGE);
      })
      .catch(() => {})
      .finally(() => setPhotosLoading(false));
  }, [activeSubId]);

  function loadMore() {
    const nextPage = page + 1;
    setPhotosLoading(true);
    fetchPublicGraphQL(EVENT_GALLERY_PICTURES_QUERY, { id: activeSubId, page: nextPage }, EVENT_ORIGIN)
      .then((result) => {
        const pics = result.data?.eventGalleryPictures ?? [];
        setPhotos((prev) => [...prev, ...pics]);
        setHasMore(pics.length === PER_PAGE);
        setPage(nextPage);
      })
      .catch(() => {})
      .finally(() => setPhotosLoading(false));
  }

  const closeLightbox = useCallback(() => setLightboxIndex(null), []);
  const prevPhoto = useCallback(() => setLightboxIndex((i) => Math.max(0, i - 1)), []);
  const nextPhoto = useCallback(
    () => setLightboxIndex((i) => Math.min(photos.length - 1, i + 1)),
    [photos.length]
  );

  return (
    <main
      dir={isRTL ? "rtl" : "ltr"}
      lang={lang}
      className="min-h-screen pb-32"
      style={{ background: "var(--bg)", color: "var(--text)" }}
    >
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-[#00ffb3]/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-[350px] h-[350px] bg-[#054041]/60 rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-md mx-auto px-4">
        <PageHeader
          title={title}
          subtitle={subtitle}
          title_en={title_en}
          subtitle_en={subtitle_en}
          isHomeContext={isHomeContext}
        />

        {/* ── Edition row (level 1) ── */}
        <div
          className="pb-3 mb-1"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <p className="text-[11px] font-semibold mb-2" style={{ color: "var(--text-dim)" }}>
            {lang === "fa" ? "دوره نمایشگاه" : "Edition"}
          </p>
          {catLoading ? (
            <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="flex-shrink-0 h-9 rounded-full animate-pulse"
                  style={{ width: i * 28 + 56, background: "var(--surface)" }}
                />
              ))}
            </div>
          ) : (
            <div
              className="flex gap-2 overflow-x-auto"
              style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
            >
              {[...categories].reverse().map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => { if (cat.id !== activeCatId) setActiveCatId(cat.id); }}
                  className="flex-shrink-0 rounded-full transition-all duration-150"
                  style={{
                    padding: "8px 16px",
                    fontSize: 14,
                    fontWeight: 600,
                    ...(cat.id === activeCatId
                      ? { background: "var(--accent)", color: "#000", border: "1px solid transparent" }
                      : { background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border)" }
                    ),
                  }}
                >
                  {displayName(cat)}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Sub-category row (level 2) ── */}
        {(subLoading || subCategories.length > 0) && (
          <div className="mt-3 mb-4">
            <p className="text-[11px] font-semibold mb-2" style={{ color: "var(--text-dim)" }}>
              {lang === "fa" ? "بخش" : "Section"}
            </p>
            {subLoading ? (
              <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="flex-shrink-0 h-7 rounded-full animate-pulse"
                    style={{ width: i * 20 + 56, background: "var(--surface)" }}
                  />
                ))}
              </div>
            ) : (
              <div
                className="flex gap-2 overflow-x-auto"
                style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
              >
                {subCategories.map((sub) => (
                  <button
                    key={sub.id}
                    onClick={() => { if (sub.id !== activeSubId) setActiveSubId(sub.id); }}
                    className="flex-shrink-0 rounded-full transition-all duration-150"
                    style={{
                      padding: "4px 12px",
                      fontSize: 12,
                      fontWeight: 500,
                      ...(sub.id === activeSubId
                        ? {
                            background: "color-mix(in srgb, var(--accent) 20%, transparent)",
                            color: "var(--accent)",
                            border: "1px solid var(--accent)",
                          }
                        : {
                            background: "transparent",
                            color: "var(--text-dim)",
                            border: "1px solid var(--border)",
                          }
                      ),
                    }}
                  >
                    {displayName(sub)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Photo grid */}
        {photosLoading && photos.length === 0 ? (
          <div className="grid grid-cols-3 gap-1.5">
            {Array.from({ length: 9 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl animate-pulse"
                style={{ aspectRatio: "1 / 1", background: "var(--surface)" }}
              />
            ))}
          </div>
        ) : photos.length === 0 && !photosLoading ? (
          <div className="text-center py-16 text-sm" style={{ color: "var(--text-dim)" }}>
            {lang === "fa" ? "عکسی موجود نیست" : "No photos available"}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-1.5">
              {photos.map((photo, idx) => {
                const src = picUrl(photo.picture, "320");
                return (
                  <button
                    key={photo.id}
                    onClick={() => setLightboxIndex(idx)}
                    className="rounded-xl overflow-hidden block"
                    style={{ aspectRatio: "1 / 1", background: "var(--surface)" }}
                  >
                    {src && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={src}
                        alt=""
                        loading="lazy"
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                          display: "block",
                        }}
                      />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Load more */}
            {hasMore && (
              <div className="mt-5 flex justify-center">
                <button
                  onClick={loadMore}
                  disabled={photosLoading}
                  className="px-6 py-2.5 rounded-xl text-sm font-semibold"
                  style={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    color: photosLoading ? "var(--text-dim)" : "var(--text)",
                    cursor: photosLoading ? "default" : "pointer",
                    opacity: photosLoading ? 0.6 : 1,
                  }}
                >
                  {photosLoading
                    ? (lang === "fa" ? "در حال بارگذاری..." : "Loading...")
                    : (lang === "fa" ? "بارگذاری بیشتر" : "Load More")}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {lightboxIndex !== null && (
        <Lightbox
          photos={photos}
          index={lightboxIndex}
          onClose={closeLightbox}
          onPrev={prevPhoto}
          onNext={nextPhoto}
        />
      )}

      <BottomNav />
    </main>
  );
}
