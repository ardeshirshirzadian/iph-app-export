'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';

const EmojiPicker = dynamic(() => import('emoji-picker-react'), { ssr: false });

export default function EmojiPickerInput({ value, onChange, size = 'normal' }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  const handleClickOutside = useCallback((e) => {
    if (containerRef.current && !containerRef.current.contains(e.target)) {
      setOpen(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open, handleClickOutside]);

  function handleEmojiClick(emojiData) {
    onChange(emojiData.emoji);
    setOpen(false);
  }

  const isSmall = size === 'small';

  const btnStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: isSmall ? '4px 10px' : '7px 14px',
    background: '#0f1117',
    border: '1px solid #252a38',
    borderRadius: 8,
    cursor: 'pointer',
    fontFamily: 'Vazirmatn, sans-serif',
    fontSize: isSmall ? 13 : 14,
    color: '#e2e8f0',
    transition: 'border-color 0.15s',
    minWidth: isSmall ? 80 : 100,
  };

  const emojiSpanStyle = {
    fontSize: isSmall ? 18 : 22,
    lineHeight: 1,
  };

  const labelStyle = {
    fontSize: isSmall ? 11 : 12,
    color: '#64748b',
  };

  const pickerWrapStyle = {
    position: 'absolute',
    zIndex: 9999,
    marginTop: 6,
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    borderRadius: 12,
    overflow: 'hidden',
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        style={btnStyle}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#3b82f6'; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = open ? '#3b82f6' : '#252a38'; }}
        onClick={() => setOpen((v) => !v)}
        title="انتخاب ایموجی"
      >
        <span style={emojiSpanStyle}>{value || '😊'}</span>
        <span style={labelStyle}>▾</span>
      </button>

      {open && (
        <div style={pickerWrapStyle}>
          <EmojiPicker
            onEmojiClick={handleEmojiClick}
            skinTonesDisabled
            searchPlaceholder="جستجو..."
            width={300}
            height={380}
          />
        </div>
      )}
    </div>
  );
}
