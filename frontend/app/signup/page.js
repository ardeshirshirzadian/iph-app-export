import { redirect } from 'next/navigation';

// Signup is now a single OTP-first step of /login: entering a mobile/email
// that has no Rasayesh account transitions straight into a "complete your
// profile" step there. This route only exists so old links/bookmarks still work.
export default function SignupPage() {
  redirect('/login');
}
