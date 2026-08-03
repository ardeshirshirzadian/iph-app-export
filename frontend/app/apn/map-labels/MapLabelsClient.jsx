'use client';

import { useState } from 'react';

const FIELDS = [
  {
    group: 'نوار جستجو',
    items: [
      { key: 'search_placeholder_fa', label: 'پلاس‌هولدر جستجو (فارسی)', dir: 'rtl' },
      { key: 'search_placeholder_en', label: 'Search bar placeholder (English)', dir: 'ltr' },
    ],
  },
  {
    group: 'دکمه مقصد',
    items: [
      { key: 'set_destination_fa', label: 'متن دکمه «تنظیم مقصد» (فارسی)', dir: 'rtl' },
      { key: 'set_destination_en', label: '"Set as destination" button (English)', dir: 'ltr' },
    ],
  },
  {
    group: 'پنل انتخاب مبدأ',
    items: [
      { key: 'origin_panel_title_fa', label: 'عنوان پنل مبدأ (فارسی)', dir: 'rtl' },
      { key: 'origin_panel_title_en', label: 'Origin panel title (English)', dir: 'ltr' },
      { key: 'origin_search_placeholder_fa', label: 'پلاس‌هولدر جستجوی مبدأ (فارسی)', dir: 'rtl' },
      { key: 'origin_search_placeholder_en', label: 'Origin search placeholder (English)', dir: 'ltr' },
    ],
  },
];

export default function MapLabelsClient({ initialConfig }) {
  const [config, setConfig] = useState(initialConfig);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);

  const update = (key, value) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
    setSaveStatus(null);
  };

  const threshold = Number(config.booth_label_zoom_threshold ?? 600);

  const handleSave = async () => {
    setSaving(true);
    setSaveStatus(null);
    try {
      const res = await fetch('/api/admin/map-labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      });
      setSaveStatus(res.ok ? 'ok' : 'err');
    } catch {
      setSaveStatus('err');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* ── Booth label zoom threshold ── */}
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 14,
          padding: 20,
        }}
      >
        <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', margin: '0 0 4px' }}>
          نمایش نام غرفه در نمای ۳D
        </h3>
        <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '0 0 16px' }}>
          برچسب نام غرفه (فارسی/انگلیسی) هنگامی که دوربین به اندازه کافی نزدیک باشد روی سقف غرفه‌ها نمایش داده می‌شود.
          مقدار ۰ = برچسب‌ها همیشه پنهان. مقدار بیشتر = از فاصله بیشتری قابل مشاهده‌اند.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            آستانه نمایش نام غرفه (واحد نقشه) — مقدار فعلی: <strong style={{ color: 'var(--text)' }}>{threshold}</strong>
          </label>
          <input
            type="range"
            min={0}
            max={3000}
            step={50}
            value={threshold}
            onChange={(e) => update('booth_label_zoom_threshold', Number(e.target.value))}
            style={{ width: '100%', accentColor: 'var(--accent)' }}
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="number"
              min={0}
              max={3000}
              step={50}
              value={threshold}
              onChange={(e) => update('booth_label_zoom_threshold', Math.max(0, Math.min(3000, Number(e.target.value) || 0)))}
              style={{
                width: 100,
                background: 'var(--surface-input)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '6px 10px',
                fontSize: 13,
                color: 'var(--text)',
                fontFamily: 'inherit',
                outline: 'none',
              }}
            />
            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
              پیشنهاد: ۶۰۰ (نمایش در نزدیکی) — ۱۵۰۰ (نمایش از فاصله متوسط)
            </span>
          </div>
        </div>
      </div>

      {FIELDS.map(({ group, items }) => (
        <div
          key={group}
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 14,
            padding: 20,
          }}
        >
          <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', margin: '0 0 16px' }}>
            {group}
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {items.map(({ key, label, dir }) => (
              <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 12, color: 'var(--text-dim)' }}>{label}</label>
                <input
                  type="text"
                  dir={dir}
                  value={config[key] ?? ''}
                  onChange={(e) => update(key, e.target.value)}
                  style={{
                    background: 'var(--surface-input)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: '8px 12px',
                    fontSize: 13,
                    color: 'var(--text)',
                    fontFamily: 'inherit',
                    outline: 'none',
                    width: '100%',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          style={{
            background: '#3b82f6',
            color: '#fff',
            border: 'none',
            borderRadius: 10,
            padding: '10px 24px',
            fontSize: 14,
            fontWeight: 700,
            cursor: saving ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.6 : 1,
            fontFamily: 'inherit',
          }}
        >
          {saving ? 'در حال ذخیره...' : 'ذخیره برچسب‌ها'}
        </button>
        {saveStatus === 'ok' && (
          <span style={{ color: '#22c55e', fontSize: 13 }}>✓ ذخیره شد — بعد از رفرش صفحه اعمال می‌شود</span>
        )}
        {saveStatus === 'err' && (
          <span style={{ color: '#ef4444', fontSize: 13 }}>خطا در ذخیره. دوباره تلاش کنید.</span>
        )}
      </div>
    </div>
  );
}
