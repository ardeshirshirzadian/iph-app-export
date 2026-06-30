"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import PageHeader from "@/components/PageHeader";
import { useLang } from "@/lib/useLang";
import { t } from "@/lib/i18n";

const STORAGE_KEY = "iph_chat_history";

const INITIAL_GREETING = [
  {
    role: "bot",
    text: "سلام 👋 من دستیار هوش مصنوعی نمایشگاه ایران فارما هستم. چطور می‌تونم کمکتون کنم؟",
  },
];

function loadHistory() {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {
    // corrupted storage — fall through to default
  }
  return INITIAL_GREETING;
}

function saveHistory(messages) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  } catch {
    // storage quota exceeded or unavailable — ignore
  }
}

// eslint-disable-next-line no-unused-vars
function clearHistory() {
  sessionStorage.removeItem(STORAGE_KEY);
}

export default function ChatClient({ title, subtitle, title_en, subtitle_en }) {
  const [messages, setMessages] = useState(loadHistory);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);
  const { lang, isRTL } = useLang();

  useEffect(() => {
    document.title = "IPH Chatbot";
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    saveHistory(messages);
  }, [messages]);

  const sendMessage = async () => {
    const question = input.trim();
    if (!question || loading) return;

    const updatedMessages = [...messages, { role: "user", text: question }];
    setMessages(updatedMessages);
    setInput("");
    setLoading(true);

    const controller = new AbortController();
    // 95s client timeout — slightly longer than the server's 90s so the server
    // timeout fires first and returns a structured 504 response when possible.
    const clientTimeout = setTimeout(() => controller.abort(), 95_000);

    try {
      const API_URL = process.env.NEXT_PUBLIC_API_URL || "/api/chat";

      const history = messages
        .filter((m) => m.role === "user" || m.role === "bot")
        .map((m) => ({
          role: m.role === "bot" ? "assistant" : "user",
          content: m.text,
        }));

      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: question, history }),
        signal: controller.signal,
      });

      const data = await res.json();

      setMessages((prev) => [
        ...prev,
        {
          role: "bot",
          text:
            res.status === 504
              ? t(lang, "chat_timeout")
              : data.answer || t(lang, "chat_no_answer"),
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "bot",
          text:
            err.name === "AbortError"
              ? t(lang, "chat_timeout")
              : t(lang, "chat_error"),
        },
      ]);
    } finally {
      clearTimeout(clientTimeout);
      setLoading(false);
    }
  };

  return (
    <main
      dir={isRTL ? "rtl" : "ltr"}
      lang={lang}
      className="relative overflow-x-hidden min-h-screen flex flex-col p-4"
      style={{ background: "var(--bg)", color: "var(--text)" }}
    >
      {/* Background glow */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] rounded-full blur-3xl" style={{ background: "color-mix(in srgb, var(--accent) 5%, transparent)" }} />
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] rounded-full blur-3xl" style={{ background: "var(--surface)" }} />
      </div>

      <div className="relative w-full max-w-5xl mx-auto flex flex-col flex-1">
        <PageHeader title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} />

        <section className="relative w-full grid md:grid-cols-[300px_1fr] gap-4 flex-1">

          {/* ── Sidebar ── */}
          <aside
            className="hidden md:flex flex-col justify-between rounded-3xl p-6"
            style={{ border: "1px solid var(--border)", background: "var(--surface-2)", backdropFilter: "blur(24px)" }}
          >
            <div className="space-y-6">
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center"
                style={{ background: "color-mix(in srgb, var(--accent) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)" }}
              >
                <span className="text-xl font-black" style={{ color: "var(--accent)" }}>✦</span>
              </div>

              <div>
                <h2 className="text-2xl font-black leading-snug" style={{ color: "var(--text)" }}>
                  IPH<br />Chatbot
                </h2>
                <p className="text-sm mt-3 leading-7" style={{ color: "var(--text-muted)" }}>
                  {t(lang, "chat_description")}
                </p>
              </div>

              <div className="h-px" style={{ background: "var(--border)" }} />

              <ul className="space-y-3 text-sm" style={{ color: "var(--text-dim)" }}>
                {[
                  t(lang, "chat_feature_1"),
                  t(lang, "chat_feature_2"),
                  t(lang, "chat_feature_3"),
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: "color-mix(in srgb, var(--accent) 60%, transparent)" }} />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-2 mt-6">
              <div className="rounded-2xl p-4" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                <p className="text-xs mb-1" style={{ color: "var(--text-faint)" }}>{t(lang, "chat_status_label")}</p>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: "var(--accent)" }} />
                  <p className="text-sm font-semibold" style={{ color: "var(--accent)" }}>{t(lang, "chat_online")}</p>
                </div>
              </div>
              <div className="rounded-2xl p-4" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                <p className="text-xs mb-1" style={{ color: "var(--text-faint)" }}>{t(lang, "chat_source_label")}</p>
                <p className="text-sm font-semibold" style={{ color: "var(--text-muted)" }}>RAG Knowledge Base</p>
              </div>
            </div>
          </aside>

          {/* ── Chat Panel ── */}
          <div
            className="h-[80vh] min-h-[500px] rounded-3xl flex flex-col overflow-hidden"
            style={{ border: "1px solid var(--border)", background: "var(--bg)", backdropFilter: "blur(24px)" }}
          >
            {/* Header */}
            <header
              className="flex items-center justify-between px-5 py-4 flex-shrink-0"
              style={{ borderBottom: "1px solid var(--border)", background: "var(--surface-2)" }}
            >
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-black"
                    style={{ background: "color-mix(in srgb, var(--accent) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)", color: "var(--accent)" }}
                  >
                    AI
                  </div>
                  <span
                    className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2"
                    style={{ background: "var(--accent)", borderColor: "var(--bg)" }}
                  />
                </div>
                <div>
                  <h2 className="font-bold text-base leading-tight" style={{ color: "var(--text)" }}>IPH Chatbot</h2>
                  <p className="text-[11px]" style={{ color: "var(--text-faint)" }}>{t(lang, "chat_powered_by")}</p>
                </div>
              </div>
              <span
                className="text-[11px] px-3 py-1 rounded-full hidden sm:block"
                style={{ color: "color-mix(in srgb, var(--accent) 70%, transparent)", border: "1px solid var(--border-accent)", background: "color-mix(in srgb, var(--accent) 5%, transparent)" }}
              >
                {t(lang, "chat_version")}
              </span>
            </header>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-5 space-y-4 scroll-smooth">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex items-end gap-2 ${
                    msg.role === "user" ? "justify-start" : "justify-end"
                  }`}
                >
                  {msg.role === "user" && (
                    <div
                      className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center text-[10px] font-bold mb-0.5"
                      style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)" }}
                    >
                      {t(lang, "chat_you")}
                    </div>
                  )}

                  <div
                    className={`max-w-[78%] md:max-w-[65%] px-4 py-3 text-sm leading-7 ${
                      msg.role === "user"
                        ? "rounded-3xl rounded-tr-sm font-medium"
                        : "rounded-3xl rounded-tl-sm"
                    }`}
                    style={
                      msg.role === "user"
                        ? { background: "var(--accent)", color: "var(--bg)" }
                        : { background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" }
                    }
                  >
                    {msg.role === "bot" ? (
                      <div className="prose prose-sm max-w-none prose-p:my-1 prose-li:my-0">
                        <ReactMarkdown>{msg.text}</ReactMarkdown>
                      </div>
                    ) : (
                      msg.text
                    )}
                  </div>

                  {msg.role === "bot" && (
                    <div
                      className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center text-[10px] font-black mb-0.5"
                      style={{ background: "color-mix(in srgb, var(--accent) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)", color: "var(--accent)" }}
                    >
                      AI
                    </div>
                  )}
                </div>
              ))}

              {loading && (
                <div className="flex items-end gap-2 justify-end">
                  <div
                    className="rounded-3xl rounded-tl-sm px-5 py-4"
                    style={{ background: "var(--surface)", border: "1px solid var(--border-accent)" }}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full animate-bounce" style={{ background: "var(--accent)" }} />
                      <span className="w-2 h-2 rounded-full animate-bounce [animation-delay:150ms]" style={{ background: "var(--accent)" }} />
                      <span className="w-2 h-2 rounded-full animate-bounce [animation-delay:300ms]" style={{ background: "var(--accent)" }} />
                    </div>
                  </div>
                  <div
                    className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center text-[10px] font-black"
                    style={{ background: "color-mix(in srgb, var(--accent) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)", color: "var(--accent)" }}
                  >
                    AI
                  </div>
                </div>
              )}

              <div ref={bottomRef} />
            </div>

            {/* Footer / Input */}
            <footer
              className="px-4 py-3 flex-shrink-0"
              style={{ borderTop: "1px solid var(--border)", background: "var(--surface-2)" }}
            >
              <div
                className="flex gap-2 items-center rounded-2xl px-4 py-2 transition-colors"
                style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
              >
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                  placeholder={t(lang, "chat_placeholder")}
                  className="flex-1 bg-transparent outline-none text-sm py-2 placeholder:text-[var(--text-faint)]"
                  style={{ color: "var(--text)" }}
                />
                <button
                  onClick={sendMessage}
                  disabled={loading}
                  className="flex-shrink-0 font-bold text-sm px-5 py-2.5 rounded-xl transition-colors disabled:opacity-40"
                  style={{ background: "var(--accent)", color: "var(--bg)" }}
                >
                  {t(lang, "chat_send")}
                </button>
              </div>
              <p className="text-[10px] text-center mt-2" style={{ color: "var(--text-faint)" }}>
                {t(lang, "chat_disclaimer")}
              </p>
            </footer>
          </div>
        </section>
      </div>
    </main>
  );
}
