"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import PageHeader from "@/components/PageHeader";
import BottomNav from "@/app/components/BottomNav";
import { useLang } from "@/lib/useLang";
import { t } from "@/lib/i18n";
import { toPersianDigits } from "@/lib/utils";
import Button from "@/components/Button";

const STORAGE_KEY = "iph_chat_history";

const DEFAULT_GREETING_FA = "سلام 👋 من دستیار هوش مصنوعی نمایشگاه ایران فارما هستم. چطور می‌تونم کمکتون کنم؟";
const DEFAULT_GREETING_EN = "Hello 👋 I'm the IranPharma exhibition AI assistant. How can I help you?";

const INITIAL_GREETING = [{ role: "bot", text: DEFAULT_GREETING_FA }];

const DISALLOWED_FA_CHARS = /[^\u0600-\u06FF\u200C0-9\s.,?!:;()\-"]/g;
const DISALLOWED_EN_CHARS = /[^a-zA-Z0-9\s.,?!:;()\-"]/g;

function filterInputByLang(value, lang) {
  return value.replace(lang === "en" ? DISALLOWED_EN_CHARS : DISALLOWED_FA_CHARS, "");
}

const QUEUE_POLL_INTERVAL_MS = 1800;
const QUEUE_POLL_MAX_FAILURES = 5;

function queuedStatusText(queueInfo, lang) {
  const { position, estimatedWaitSeconds } = queueInfo;
  const posDigits = lang === "fa" ? toPersianDigits(position) : position;
  let text = t(lang, "chat_queued_position").replace("{position}", posDigits);
  if (estimatedWaitSeconds != null) {
    const waitDigits = lang === "fa" ? toPersianDigits(estimatedWaitSeconds) : estimatedWaitSeconds;
    text += t(lang, "chat_queued_wait").replace("{seconds}", waitDigits);
  }
  return text;
}

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

export default function ChatClient({ title, subtitle, title_en, subtitle_en, isHomeContext = false, showBack = true }) {
  const [messages, setMessages] = useState(loadHistory);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [queueInfo, setQueueInfo] = useState(null);
  const [chatConfig, setChatConfig] = useState(null);
  const bottomRef = useRef(null);
  const pollIntervalRef = useRef(null);
  const mountedRef = useRef(true);
  const { lang, isRTL } = useLang();

  useEffect(() => {
    document.title = "IPH Chatbot";
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, queueInfo]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    saveHistory(messages);
  }, [messages]);

  useEffect(() => {
    fetch("/api/chat/config")
      .then((res) => res.json())
      .then((data) => setChatConfig(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!chatConfig) return;
    const defaultGreeting = lang === "en" ? DEFAULT_GREETING_EN : DEFAULT_GREETING_FA;
    const greeting = lang === "en" ? chatConfig.greeting_en : chatConfig.greeting_fa;
    if (!greeting || greeting === defaultGreeting) return;
    setMessages((prev) => {
      if (prev.length !== 1 || prev[0].role !== "bot" || prev[0].text === greeting) return prev;
      return [{ role: "bot", text: greeting }];
    });
  }, [chatConfig, lang]);

  const chatSubtitle = !chatConfig
    ? null
    : (lang === "en" ? chatConfig.subtitle_en : chatConfig.subtitle_fa) || t(lang, "chat_powered_by");
  const badge = !chatConfig
    ? null
    : (lang === "en" ? chatConfig.badge_en : chatConfig.badge_fa) || t(lang, "chat_version");
  const placeholder = !chatConfig
    ? ""
    : (lang === "en" ? chatConfig.placeholder_en : chatConfig.placeholder_fa) || t(lang, "chat_placeholder");
  const footer = !chatConfig
    ? null
    : (lang === "en" ? chatConfig.footer_en : chatConfig.footer_fa) || t(lang, "chat_disclaimer");

  const appendBotMessage = (text) => {
    setMessages((prev) => [...prev, { role: "bot", text }]);
  };

  const stopQueuePolling = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  const startQueuePolling = (queueId) => {
    stopQueuePolling();
    let failures = 0;

    const poll = async () => {
      try {
        const res = await fetch(`/api/chat/status/${queueId}`);
        const data = await res.json();
        if (!mountedRef.current) return;

        if (data.status === "done") {
          stopQueuePolling();
          appendBotMessage(data.answer || t(lang, "chat_no_answer"));
          setQueueInfo(null);
          setLoading(false);
        } else if (data.status === "busy") {
          stopQueuePolling();
          appendBotMessage(t(lang, "chat_busy"));
          setQueueInfo(null);
          setLoading(false);
        } else if (data.status === "queued") {
          failures = 0;
          setQueueInfo((prev) => ({
            position: data.position,
            estimatedWaitSeconds: prev?.estimatedWaitSeconds,
          }));
        } else {
          throw new Error("unexpected status shape");
        }
      } catch {
        failures += 1;
        if (failures >= QUEUE_POLL_MAX_FAILURES && mountedRef.current) {
          stopQueuePolling();
          appendBotMessage(t(lang, "chat_error"));
          setQueueInfo(null);
          setLoading(false);
        }
      }
    };

    pollIntervalRef.current = setInterval(poll, QUEUE_POLL_INTERVAL_MS);
  };

  const sendMessage = async () => {
    const question = input.trim();
    if (!question || loading) return;

    const updatedMessages = [...messages, { role: "user", text: question }];
    setMessages(updatedMessages);
    setInput("");
    setLoading(true);
    setQueueInfo(null);

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
        body: JSON.stringify({ message: question, history, lang }),
        signal: controller.signal,
      });

      const data = await res.json();

      if (data?.status === "queued" && data?.queue_id) {
        setQueueInfo({
          position: data.position,
          estimatedWaitSeconds: data.estimated_wait_seconds,
        });
        startQueuePolling(data.queue_id);
        // loading stays true — the queue poller owns it from here on.
        return;
      }

      appendBotMessage(
        data.source === "busy"
          ? t(lang, "chat_busy")
          : res.status === 504
          ? t(lang, "chat_timeout")
          : data.answer || t(lang, "chat_no_answer")
      );
      setLoading(false);
    } catch (err) {
      appendBotMessage(
        err.name === "AbortError"
          ? t(lang, "chat_timeout")
          : t(lang, "chat_error")
      );
      setLoading(false);
    } finally {
      clearTimeout(clientTimeout);
    }
  };

  return (
    <main
      dir={isRTL ? "rtl" : "ltr"}
      lang={lang}
      className="flex flex-col overflow-hidden"
      style={{ background: "var(--bg)", color: "var(--text)", height: "100dvh" }}
    >
      {/* Background glow */}
      <div className="dark-only fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] rounded-full blur-3xl" style={{ background: "color-mix(in srgb, var(--accent) 5%, transparent)" }} />
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] rounded-full blur-3xl" style={{ background: "var(--surface)" }} />
      </div>

      {/* Content column — fills viewport minus BottomNav spacer */}
      <div className="relative flex flex-col flex-1 min-h-0 max-w-md mx-auto w-full px-4">
        <PageHeader title={title} subtitle={subtitle} title_en={title_en} subtitle_en={subtitle_en} isHomeContext={isHomeContext} showBack={showBack} />

        {/* Chat panel — fills remaining height; only the message list scrolls */}
        <div
          className="flex-1 min-h-0 flex flex-col overflow-hidden rounded-3xl"
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
                <p className="text-[11px]" style={{ color: "var(--text-faint)" }}>
                  {chatSubtitle ?? (
                    <span className="inline-block h-2.5 w-20 rounded-full animate-pulse" style={{ background: "var(--border)" }} />
                  )}
                </p>
              </div>
            </div>
            <span
              className="text-[11px] px-3 py-1 rounded-full"
              style={{ color: "color-mix(in srgb, var(--accent) 70%, transparent)", border: "1px solid var(--border-accent)", background: "color-mix(in srgb, var(--accent) 5%, transparent)" }}
            >
              {badge ?? (
                <span className="inline-block h-2.5 w-8 rounded-full animate-pulse" style={{ background: "var(--border-accent)" }} />
              )}
            </span>
          </header>

          {/* Messages — ONLY this region scrolls */}
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-5 space-y-4 scroll-smooth">
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
                  className={`max-w-[78%] px-4 py-3 text-sm leading-7 ${
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
                  {queueInfo && (
                    <div className="mb-2 space-y-0.5">
                      <p className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
                        {t(lang, "chat_queued")}
                      </p>
                      <p className="text-[11px]" style={{ color: "var(--text-faint)" }}>
                        {queuedStatusText(queueInfo, lang)}
                      </p>
                    </div>
                  )}
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

          {/* Footer / Input — always visible, never scrolled away */}
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
                onChange={(e) => setInput(filterInputByLang(e.target.value, lang))}
                onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                placeholder={placeholder}
                className="flex-1 bg-transparent outline-none text-sm py-2 placeholder:text-[var(--text-faint)]"
                style={{ color: "var(--text)" }}
              />
              <Button
                onClick={sendMessage}
                disabled={loading}
                variant="primary"
                size="sm"
              >
                {t(lang, "chat_send")}
              </Button>
            </div>
            <p className="text-[10px] text-center mt-2" style={{ color: "var(--text-faint)" }}>
              {footer ?? (
                <span className="inline-block h-2 w-32 rounded-full animate-pulse mx-auto" style={{ background: "var(--border)" }} />
              )}
            </p>
          </footer>
        </div>
      </div>

      {/* Spacer so BottomNav (fixed) doesn't overlap the chat footer */}
      <div className="flex-shrink-0" style={{ height: "calc(48px + env(safe-area-inset-bottom))" }} />

      <BottomNav />
    </main>
  );
}
