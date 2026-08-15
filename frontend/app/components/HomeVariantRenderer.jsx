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

export default function HomeVariantRenderer({ route, ...props }) {
  switch (route) {
    case '/quest':
      return <QuestClient {...props} />;
    case '/companies':
      return <CompaniesClient {...props} />;
    case '/panels':
      return <PanelsClient {...props} />;
    case '/badge':
      return <BadgeClient {...props} />;
    case '/map':
      return <MapClient {...props} />;
    case '/chat':
      return <ChatClient {...props} />;
    case '/notifications':
      return <NotificationsClient {...props} />;
    case '/gallery':
      return <GalleryClient {...props} />;
    case '/news':
      return <NewsClient {...props} />;
    case '/profile':
      return <ProfileClient {...props} />;
    default:
      return <HomeClient {...props} />;
  }
}
