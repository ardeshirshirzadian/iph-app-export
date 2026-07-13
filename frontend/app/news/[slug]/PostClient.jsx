"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import BottomNav from "../../components/BottomNav";
import { useLang } from "@/lib/useLang";
import { t } from "@/lib/i18n";
import { fetchPublicGraphQL } from "@/lib/publicRasayeshClient";

const RASAYESH_BASE = "https://api.rasayesh.com/";

const POST_QUERY = `
  query EventBlogPost($slug: String) {
    eventBlogPost(slug: $slug) {
      id
      title
      slug
      body
      excerpt
      thumbnail
      created_at
      categories { id name }
      tags { id name }
    }
  }
`;

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
      { year: "numeric", month: "long", day: "numeric" }
    );
  } catch { return ""; }
}

export default function PostClient({ slug }) {
  const { lang, isRTL } = useLang();
  const [post, setPost] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetchPublicGraphQL(POST_QUERY, { slug }, "https://2025.iphexpo.com")
      .then((result) => {
        const p = result.data?.eventBlogPost ?? null;
        if (!p) setNotFound(true);
        else setPost(p);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [slug]);

  return (
    <main
      dir={isRTL ? "rtl" : "ltr"}
      lang={lang}
      className="relative flex flex-col pb-28"
      style={{ background: "var(--bg)", color: "var(--text)", minHeight: "100dvh" }}
    >
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-[#00ffb3]/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-[350px] h-[350px] bg-[#054041]/60 rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-2xl mx-auto px-4 pt-6">
        <Link
          href="/news"
          className="inline-block mb-4 text-sm"
          style={{ color: "var(--accent)" }}
        >
          {t(lang, "news_back")}
        </Link>

        {loading && (
          <div className="animate-pulse">
            <div className="rounded-2xl mb-4" style={{ width: "100%", aspectRatio: "16/9", background: "var(--surface)" }} />
            <div className="h-5 rounded mb-3" style={{ background: "var(--surface)", width: "80%" }} />
            <div className="h-3 rounded mb-6" style={{ background: "var(--surface)", width: "30%" }} />
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-3 rounded mb-2" style={{ background: "var(--surface)", width: i % 2 === 0 ? "90%" : "100%" }} />
            ))}
          </div>
        )}

        {!loading && (notFound || !post) && (
          <div className="text-center py-16" style={{ color: "var(--text-dim)" }}>
            {t(lang, "no_data")}
          </div>
        )}

        {!loading && post && (() => {
          const cover = thumbUrl(post.thumbnail, "512");
          const tags = [...(post.categories ?? []), ...(post.tags ?? [])];
          const uniqueTags = tags.filter((tag, i, arr) => arr.findIndex((x) => x.id === tag.id) === i);
          return (
            <>
              {cover && (
                <div className="rounded-2xl overflow-hidden mb-5" style={{ width: "100%", aspectRatio: "16/9" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={cover} alt={post.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </div>
              )}

              <h1 className="text-xl font-black leading-8 mb-2" style={{ color: "var(--text)" }}>
                {post.title}
              </h1>

              <p className="text-xs mb-4" style={{ color: "var(--text-dim)" }}>
                {formatDate(post.created_at, lang)}
              </p>

              {uniqueTags.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-5">
                  {uniqueTags.slice(0, 6).map((tag) => (
                    <span
                      key={tag.id}
                      className="px-2.5 py-0.5 rounded-full text-xs"
                      style={{
                        background: "var(--surface-alt)",
                        color: "var(--accent)",
                        border: "1px solid color-mix(in srgb, var(--accent) 20%, transparent)",
                      }}
                    >
                      {tag.name}
                    </span>
                  ))}
                </div>
              )}

              {post.body ? (
                <div
                  className="news-body"
                  style={{
                    color: "var(--text-muted)",
                    lineHeight: 1.8,
                    fontSize: 14,
                    overflowWrap: "break-word",
                    wordBreak: "break-word",
                  }}
                  dangerouslySetInnerHTML={{ __html: post.body }}
                />
              ) : post.excerpt ? (
                <p className="text-sm leading-8" style={{ color: "var(--text-muted)" }}>
                  {post.excerpt}
                </p>
              ) : null}
            </>
          );
        })()}
      </div>

      <BottomNav />
    </main>
  );
}
