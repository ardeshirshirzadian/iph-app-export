"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import BottomNav from "../components/BottomNav";
import PageHeader from "@/components/PageHeader";
import { useLang } from "@/lib/useLang";
import { t } from "@/lib/i18n";

const RASAYESH_BASE = "https://api.rasayesh.com/";
const PER_PAGE = 12;

function thumbUrl(thumbnail, size) {
  if (!thumbnail) return null;
  const fmt = thumbnail.jpg || thumbnail.png || thumbnail.webp;
  if (!fmt) return null;
  return RASAYESH_BASE + (fmt[size] || fmt["512"] || fmt["256"] || Object.values(fmt)[0]);
}

function formatDate(isoStr, lang) {
  if (!isoStr) return "";
  try {
    return new Date(isoStr).toLocaleDateString(
      lang === "fa" ? "fa-IR-u-ca-persian" : "en-US",
      { year: "numeric", month: "short", day: "numeric" }
    );
  } catch { return ""; }
}

function NewsCard({ post, lang }) {
  const img = thumbUrl(post.thumbnail, "256");
  return (
    <Link
      href={`/news/${post.slug}`}
      className="rounded-2xl overflow-hidden flex flex-col active:scale-95 transition-transform duration-150"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
    >
      {img ? (
        <div style={{ width: "100%", aspectRatio: "16/9", overflow: "hidden" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img} alt={post.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </div>
      ) : (
        <div style={{ width: "100%", aspectRatio: "16/9", background: "var(--surface-alt)" }} />
      )}
      <div className="p-3 flex flex-col flex-1">
        <p
          className="text-sm font-semibold leading-snug"
          style={{
            color: "var(--text)",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {post.title}
        </p>
        {post.excerpt && (
          <p
            className="text-xs mt-1 leading-relaxed flex-1"
            style={{
              color: "var(--text-muted)",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {post.excerpt}
          </p>
        )}
        <p className="text-[10px] mt-2" style={{ color: "var(--text-dim)" }}>
          {formatDate(post.created_at, lang)}
        </p>
      </div>
    </Link>
  );
}

export default function NewsClient({ title, subtitle, title_en, subtitle_en }) {
  const { lang, isRTL } = useLang();
  const [posts, setPosts] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [order, setOrder] = useState("desc");
  const [loading, setLoading] = useState(true);
  const debounceRef = useRef(null);

  function loadNews(p, s, o) {
    setLoading(true);
    const params = new URLSearchParams({ page: String(p), search: s, order: o });
    fetch(`/api/news?${params}`)
      .then((r) => r.json())
      .then((d) => {
        setPosts(d.posts ?? []);
        setTotal(d.total ?? 0);
      })
      .catch(() => { setPosts([]); setTotal(0); })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadNews(1, "", "desc");
  }, []);

  function handleSearch(val) {
    setSearch(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      loadNews(1, val, order);
    }, 500);
  }

  function handleOrder(val) {
    setOrder(val);
    setPage(1);
    loadNews(1, search, val);
  }

  function handlePage(p) {
    setPage(p);
    loadNews(p, search, order);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const totalPages = Math.ceil(total / PER_PAGE);

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

      <div className="relative max-w-2xl mx-auto px-4">
        <PageHeader title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} />

        {/* Search + sort */}
        <div className="flex gap-2 mb-5">
          <input
            type="text"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder={t(lang, "news_search")}
            className="flex-1 rounded-xl px-4 py-2.5 text-sm"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              color: "var(--text)",
              outline: "none",
            }}
            dir={isRTL ? "rtl" : "ltr"}
          />
          <select
            value={order}
            onChange={(e) => handleOrder(e.target.value)}
            className="rounded-xl px-3 py-2.5 text-sm"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              color: "var(--text)",
              outline: "none",
              cursor: "pointer",
            }}
          >
            <option value="desc">{t(lang, "news_sort_newest")}</option>
            <option value="asc">{t(lang, "news_sort_oldest")}</option>
          </select>
        </div>

        {/* Grid */}
        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="rounded-2xl overflow-hidden animate-pulse"
                style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
              >
                <div style={{ width: "100%", aspectRatio: "16/9", background: "var(--surface-alt)" }} />
                <div className="p-3">
                  <div className="h-3 rounded mb-2" style={{ background: "var(--border)", width: "80%" }} />
                  <div className="h-3 rounded" style={{ background: "var(--border)", width: "55%" }} />
                </div>
              </div>
            ))}
          </div>
        ) : posts.length === 0 ? (
          <div className="text-center py-16" style={{ color: "var(--text-dim)" }}>
            {t(lang, "news_empty")}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {posts.map((post) => (
              <NewsCard key={post.id} post={post} lang={lang} />
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-6">
            <button
              onClick={() => handlePage(page - 1)}
              disabled={page <= 1}
              className="px-4 py-2 rounded-xl text-sm"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                color: page <= 1 ? "var(--text-dim)" : "var(--text)",
                cursor: page <= 1 ? "default" : "pointer",
              }}
            >
              {t(lang, "news_prev")}
            </button>
            <span className="text-sm" style={{ color: "var(--text-muted)" }}>
              {lang === "fa"
                ? `صفحه ${page} از ${totalPages}`
                : `Page ${page} of ${totalPages}`}
            </span>
            <button
              onClick={() => handlePage(page + 1)}
              disabled={page >= totalPages}
              className="px-4 py-2 rounded-xl text-sm"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                color: page >= totalPages ? "var(--text-dim)" : "var(--text)",
                cursor: page >= totalPages ? "default" : "pointer",
              }}
            >
              {t(lang, "news_next")}
            </button>
          </div>
        )}
      </div>

      <BottomNav />
    </main>
  );
}
