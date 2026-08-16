"use client";

import Link from "next/link";
import { useAttendee } from "./AttendeeProvider";
import { toPersianDigits } from "@/lib/utils";

const PROFILE_FIELDS = [
  (a) => !!a.firstname_fa,
  (a) => !!a.national_code,
  (a) => !!a.occupation_id,
  (a) => !!a.education_level_id,
  (a) => Array.isArray(a.field_of_activities) && a.field_of_activities.length > 0,
  (a) => !!a.profile,
];

export default function ProfileCompletionBar({ lang }) {
  const { attendee } = useAttendee();

  if (!attendee) return null;

  const completed = PROFILE_FIELDS.filter((fn) => fn(attendee)).length;
  const pct = Math.round((completed / PROFILE_FIELDS.length) * 100);

  if (pct >= 100) return null;

  const pctLabel = lang === 'fa' ? `٪${toPersianDigits(pct)}` : `${pct}%`;
  const countLabel = lang === 'fa'
    ? `${toPersianDigits(completed)} مورد از ${toPersianDigits(PROFILE_FIELDS.length)} مورد تکمیل شده`
    : `${completed} of ${PROFILE_FIELDS.length} fields completed`;

  return (
    <div
      className="mt-5 rounded-2xl px-4 py-3"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>
            {lang === 'fa' ? 'تکمیل پروفایل' : 'Complete Profile'}
          </span>
          <span className="text-xs font-bold" style={{ color: "var(--accent)" }}>
            {pctLabel}
          </span>
        </div>
        <Link
          href="/profile/edit"
          className="text-xs font-bold px-3 py-1 rounded-lg"
          style={{ background: "var(--surface-alt)", color: "var(--accent)" }}
        >
          {lang === 'fa' ? 'ویرایش' : 'Edit'}
        </Link>
      </div>
      <div className="rounded-full overflow-hidden" style={{ height: 4, background: "var(--border)" }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: "var(--accent)" }}
        />
      </div>
      <p className="text-xs mt-2" style={{ color: "var(--text-dim)" }}>
        {countLabel}
      </p>
    </div>
  );
}
