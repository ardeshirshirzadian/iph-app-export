"use client";

// Client-side dispatcher for the aliasable "/" homepage (see app/page.js).
//
// next/dynamic() only achieves real code-splitting when it's called inside a
// Client Component — per Next.js's own docs, "When a Server Component
// dynamically imports a Client Component, automatic code splitting is
// currently not supported." app/page.js is a Server Component, so its
// dynamic() calls were verified (build + inspecting actual response HTML) to
// still ship every branch's JS (three.js, react-markdown, etc.) on every "/"
// load. Moving the dynamic() calls here — one level below the Server
// Component boundary — is what actually makes them lazy.
//
// app/page.js still owns every DB read and the full switch/case that decides
// WHICH branch's data to fetch; this component only decides which
// already-resolved branch's JS to load and render.
import dynamic from "next/dynamic";
import { useLang } from "@/lib/useLang";
import PushPopup from "./PushPopup";

const HomeClient = dynamic(() => import("./HomeClient"));
const QuestClient = dynamic(() => import("../quest/QuestClient"));
const CompaniesClient = dynamic(() => import("../companies/CompaniesClient"));
const PanelsClient = dynamic(() => import("../panels/PanelsClient"));
const BadgeClient = dynamic(() => import("../badge/BadgeClient"));
const MapClient = dynamic(() => import("../map/MapClient"));
const ChatClient = dynamic(() => import("../chat/ChatClient"));
const NotificationsClient = dynamic(() => import("../notifications/NotificationsClient"));
const GalleryClient = dynamic(() => import("../gallery/GalleryClient"));
const NewsClient = dynamic(() => import("../news/NewsClient"));
const ProfileClient = dynamic(() => import("../profile/ProfileClient"));

// The push-permission prompt is rendered here -- once, above the switch --
// rather than inside HomeClient, so it shows on "/" no matter which home
// variant an event has configured (previously it only ever appeared for the
// default/services variant, since that was the only branch that rendered
// it). `pushPrompt` is pulled off props so the variant components below
// don't receive a prop they never asked for.
export default function HomeVariantRenderer({ route, pushPrompt, ...props }) {
  const { lang } = useLang();

  let variant;
  switch (route) {
    case '/quest':
      variant = <QuestClient {...props} />;
      break;
    case '/companies':
      variant = <CompaniesClient {...props} />;
      break;
    case '/panels':
      variant = <PanelsClient {...props} />;
      break;
    case '/badge':
      variant = <BadgeClient {...props} />;
      break;
    case '/map':
      variant = <MapClient {...props} />;
      break;
    case '/chat':
      variant = <ChatClient {...props} />;
      break;
    case '/notifications':
      variant = <NotificationsClient {...props} />;
      break;
    case '/gallery':
      variant = <GalleryClient {...props} />;
      break;
    case '/news':
      variant = <NewsClient {...props} />;
      break;
    case '/profile':
      variant = <ProfileClient {...props} />;
      break;
    default:
      variant = <HomeClient {...props} />;
  }

  return (
    <>
      {variant}
      <PushPopup pushPrompt={pushPrompt} lang={lang} />
    </>
  );
}
