import { NextResponse } from 'next/server';
import bcrypt from 'bcrypt';
import { query } from '@/lib/db';
import { createAdminToken } from '@/lib/adminAuth';

// In-memory rate limit: ip → { count, resetAt }
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (entry.count >= MAX_ATTEMPTS) return false;
  entry.count++;
  return true;
}

function getRedirectBase(request) {
  const host = (
    request.headers.get('x-forwarded-host') || request.headers.get('host') || 'appapn.iphexpo.com'
  ).split(':')[0];
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  const isAdminSubdomain = host === 'appapn.iphexpo.com';
  return { origin: `${proto}://${host}`, isAdminSubdomain };
}

function loginError(request, message) {
  const { origin, isAdminSubdomain } = getRedirectBase(request);
  const url = new URL(isAdminSubdomain ? '/login' : '/apn/login', origin);
  url.searchParams.set('error', message);
  return NextResponse.redirect(url);
}

export async function POST(request) {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

  if (!checkRateLimit(ip)) {
    return loginError(request, 'تعداد تلاش‌های مجاز تمام شد. لطفاً ۱۵ دقیقه صبر کنید.');
  }

  let username, password;
  try {
    const form = await request.formData();
    username = form.get('username');
    password = form.get('password');
  } catch {
    return loginError(request, 'درخواست نامعتبر');
  }

  if (!username || !password) {
    return loginError(request, 'نام کاربری و رمز عبور الزامی است');
  }

  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) {
    console.error('[admin-auth] Missing ADMIN_SESSION_SECRET');
    return loginError(request, 'خطای پیکربندی سرور');
  }

  let admin;
  try {
    const { rows } = await query(
      'SELECT id, username, password_hash, display_name, permissions, is_super_admin FROM admins WHERE username = $1',
      [username]
    );
    admin = rows[0];
  } catch (e) {
    console.error('[admin-auth] DB error:', e.message);
    return loginError(request, 'خطای سرور');
  }

  if (!admin) {
    return loginError(request, 'نام کاربری یا رمز عبور اشتباه است');
  }

  const passwordValid = await bcrypt.compare(password, admin.password_hash);
  if (!passwordValid) {
    return loginError(request, 'نام کاربری یا رمز عبور اشتباه است');
  }

  // Update last login timestamp (fire-and-forget, don't block the response)
  query('UPDATE admins SET last_login_at = NOW() WHERE id = $1', [admin.id]).catch(() => {});

  const permissions = Array.isArray(admin.permissions) ? admin.permissions : [];
  const token = createAdminToken(secret, {
    adminId: admin.id,
    username: admin.username,
    displayName: admin.display_name || admin.username,
    isSuperAdmin: admin.is_super_admin === true,
    permissions,
  });

  const { origin, isAdminSubdomain } = getRedirectBase(request);
  const response = NextResponse.redirect(new URL(isAdminSubdomain ? '/' : '/apn', origin));
  response.cookies.set('iph_admin_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 8 * 60 * 60,
  });
  return response;
}
