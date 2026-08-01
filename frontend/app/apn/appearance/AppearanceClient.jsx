'use client';

import { useState, useCallback } from 'react';

// ── Usage map (from audit) ─────────────────────────────────────────────────
const VARIANT_META = {
  primary: {
    label: 'اصلی (Primary)',
    labelEn: 'Primary',
    usage: [
      'ارسال پیام (چت)', 'دانلود کارت (بج)', 'پرداخت (سبد خرید)',
      'تأیید OTP (ورود)', 'ارسال OTP (ورود)', 'ذخیره پروفایل', 'افزودن به سبد خرید',
    ],
  },
  secondary: {
    label: 'ثانویه (Secondary)',
    labelEn: 'Secondary',
    usage: [
      'صفحه‌بندی (خبرها، گالری)', 'فیلترهای دسته‌بندی', 'اعمال کد تخفیف',
      'بازگشت به خانه', 'زبان (تنظیمات)', 'ارسال مجدد OTP',
    ],
  },
  danger: {
    label: 'خطرناک (Danger)',
    labelEn: 'Danger',
    usage: [
      'حذف آیتم (سبد خرید)', 'لغو سفارش', 'خروج از حساب (پروفایل)',
    ],
  },
  ghost: {
    label: 'شفاف (Ghost)',
    labelEn: 'Ghost',
    usage: [
      'نمایش بیشتر/کمتر', 'ویرایش شماره تماس', 'لینک‌های متنی',
    ],
  },
  icon: {
    label: 'آیکون (Icon)',
    labelEn: 'Icon',
    usage: [
      'دکمه‌های هدر (پروفایل، اعلان، سبد)', 'دکمه بستن (مودال‌ها)', 'دکمه‌های ناوبری نقشه',
    ],
  },
};

const VARIANTS = Object.keys(VARIANT_META);
const THEMES = ['dark', 'light'];
const THEME_LABELS = { dark: 'تاریک (Dark)', light: 'روشن (Light)' };

// ── Contrast checker (simple WCAG luminance) ─────────────────────────────
function hexToRgb(hex) {
  const c = hex.replace('#', '');
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return [r, g, b];
}
function relativeLuminance([r, g, b]) {
  const toLinear = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}
function contrastRatio(hex1, hex2) {
  try {
    const l1 = relativeLuminance(hexToRgb(hex1));
    const l2 = relativeLuminance(hexToRgb(hex2));
    const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
    return (hi + 0.05) / (lo + 0.05);
  } catch { return null; }
}

// ── Color field ──────────────────────────────────────────────────────────
function ColorField({ label, value, onChange }) {
  const isHex = /^#[0-9a-fA-F]{3,8}$/.test(value);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 12, color: 'var(--text-dim)' }}>{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {isHex && (
          <input
            type="color"
            value={value.length === 7 ? value : '#000000'}
            onChange={(e) => onChange(e.target.value)}
            style={{ width: 32, height: 32, padding: 0, border: 'none', borderRadius: 6, cursor: 'pointer', background: 'none' }}
          />
        )}
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. #00ffb3 or rgba(0,0,0,0.1)"
          style={{
            flex: 1, background: 'var(--surface-input)', border: '1px solid var(--border)',
            borderRadius: 8, padding: '6px 10px', fontSize: 12, color: 'var(--text)',
            fontFamily: 'monospace', outline: 'none',
          }}
        />
      </div>
    </div>
  );
}

// ── Info tooltip ─────────────────────────────────────────────────────────
function InfoTooltip({ items }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="نمونه استفاده‌ها"
        style={{
          background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-dim)',
          fontSize: 14, lineHeight: 1, padding: '0 2px', verticalAlign: 'middle',
        }}
      >ℹ️</button>
      {open && (
        <div
          style={{
            position: 'absolute', top: '120%', right: 0, zIndex: 50,
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 10, padding: '10px 14px', minWidth: 220, maxWidth: 280,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}
        >
          <p style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6, fontWeight: 700 }}>
            استفاده شده در:
          </p>
          <ul style={{ listStyle: 'disc', paddingRight: 16, margin: 0 }}>
            {items.map((u, i) => (
              <li key={i} style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.8 }}>{u}</li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setOpen(false)}
            style={{ position: 'absolute', top: 6, left: 8, background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--text-dim)' }}
          >✕</button>
        </div>
      )}
    </span>
  );
}

// ── Live preview of one variant ──────────────────────────────────────────
function VariantPreview({ variant, themeConfig, themeName }) {
  const { bg, text, border, fontSize } = themeConfig;
  const isIcon = variant === 'icon';
  const ratio = /^#/.test(bg) && /^#/.test(text) ? contrastRatio(bg, text) : null;

  const btnStyle = {
    background: bg,
    color: text,
    border: `1px solid ${border === 'transparent' ? 'transparent' : border}`,
    fontSize: `${fontSize ?? 14}px`,
    fontWeight: 700,
    borderRadius: isIcon ? '50%' : 10,
    padding: isIcon ? 0 : '10px 20px',
    width: isIcon ? 38 : 'auto',
    height: isIcon ? 38 : 'auto',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'default',
    fontFamily: 'inherit',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{THEME_LABELS[themeName]}</div>
      <div
        style={{
          padding: 16,
          borderRadius: 10,
          background: themeName === 'dark' ? '#021f20' : '#f0faf8',
          border: '1px solid var(--border)',
        }}
      >
        <button style={btnStyle}>
          {isIcon ? '✕' : VARIANT_META[variant].labelEn}
        </button>
      </div>
      {ratio !== null && (
        <span style={{ fontSize: 10, color: ratio >= 4.5 ? '#22c55e' : ratio >= 3 ? '#f59e0b' : '#ef4444' }}>
          کنتراست: {ratio.toFixed(1)}:1 {ratio < 4.5 ? '⚠️' : '✓'}
        </span>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────
export default function AppearanceClient({ initialConfig }) {
  const [config, setConfig] = useState(initialConfig);
  const [activeVariant, setActiveVariant] = useState('primary');
  const [activeTheme, setActiveTheme] = useState('dark');
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null); // null | 'ok' | 'err'

  const update = useCallback((variant, theme, field, value) => {
    setConfig((prev) => ({
      ...prev,
      [theme]: {
        ...prev[theme],
        [variant]: { ...prev[theme][variant], [field]: value },
      },
    }));
    setSaveStatus(null);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaveStatus(null);
    try {
      const res = await fetch('/api/admin/button-styles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      });
      setSaveStatus(res.ok ? 'ok' : 'err');
    } catch { setSaveStatus('err'); }
    finally { setSaving(false); }
  };

  const vc = config[activeTheme][activeVariant];
  const meta = VARIANT_META[activeVariant];

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      {/* Variant tabs */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
        {VARIANTS.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setActiveVariant(v)}
            style={{
              padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s',
              background: activeVariant === v ? 'var(--accent)' : 'var(--surface)',
              color: activeVariant === v ? '#fff' : 'var(--text-dim)',
              border: activeVariant === v ? '1px solid var(--accent)' : '1px solid var(--border)',
            }}
          >
            {VARIANT_META[v].label}
          </button>
        ))}
      </div>

      {/* Variant panel */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 24 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>
            دکمه‌های {meta.label}
          </h2>
          <InfoTooltip items={meta.usage} />
        </div>

        {/* Theme tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
          {THEMES.map((th) => (
            <button
              key={th}
              type="button"
              onClick={() => setActiveTheme(th)}
              style={{
                padding: '5px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s',
                background: activeTheme === th ? 'rgba(59,130,246,0.15)' : 'transparent',
                color: activeTheme === th ? '#3b82f6' : 'var(--text-dim)',
                border: activeTheme === th ? '1px solid rgba(59,130,246,0.4)' : '1px solid var(--border)',
              }}
            >
              {THEME_LABELS[th]}
            </button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {/* Fields */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <ColorField
              label="رنگ پس‌زمینه (bg)"
              value={vc.bg}
              onChange={(v) => update(activeVariant, activeTheme, 'bg', v)}
            />
            <ColorField
              label="رنگ متن (text)"
              value={vc.text}
              onChange={(v) => update(activeVariant, activeTheme, 'text', v)}
            />
            <ColorField
              label="رنگ حاشیه (border)"
              value={vc.border}
              onChange={(v) => update(activeVariant, activeTheme, 'border', v)}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 12, color: 'var(--text-dim)' }}>اندازه فونت (px)</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  type="range"
                  min={10}
                  max={24}
                  step={1}
                  value={vc.fontSize ?? 14}
                  onChange={(e) => update(activeVariant, activeTheme, 'fontSize', Number(e.target.value))}
                  style={{ flex: 1 }}
                />
                <span style={{ fontSize: 13, color: 'var(--text)', minWidth: 28, textAlign: 'center' }}>
                  {vc.fontSize ?? 14}
                </span>
              </div>
            </div>
          </div>

          {/* Preview — both themes side by side */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: 0 }}>پیش‌نمایش</p>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {THEMES.map((th) => (
                <VariantPreview
                  key={th}
                  variant={activeVariant}
                  themeConfig={config[th][activeVariant]}
                  themeName={th}
                />
              ))}
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
              تغییرات هر دو تم به‌طور مستقل قابل تنظیم هستند.
            </p>
          </div>
        </div>
      </div>

      {/* Save bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 24 }}>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          style={{
            background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 10,
            padding: '10px 24px', fontSize: 14, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.6 : 1, fontFamily: 'inherit',
          }}
        >
          {saving ? 'در حال ذخیره...' : 'ذخیره تنظیمات'}
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
