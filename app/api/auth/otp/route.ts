import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { generateOTP, generateHash } from '@/lib/crypto';
import { sendOTPEmail } from '@/lib/email';

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
    }

    // 1. Generate the 6-digit OTP
    const otp = generateOTP();

    // 2. Determine expiration time (e.g., 10 minutes from now)
    const expires = Date.now() + 10 * 60 * 1000;

    // 3. Create the hash to securely store in the cookie
    // The payload includes the email, expiration time, and the plain OTP.
    const payloadToHash = `${email}|${expires}|${otp}`;
    const hash = generateHash(payloadToHash);

    // 4. Send the OTP via email
    await sendOTPEmail(email, otp);

    // 5. Set the HTTP-only cookie
    // We store the email, expires, and hash. We DO NOT store the OTP.
    const cookieValue = JSON.stringify({ email, expires, hash });
    const cookieStore = await cookies();
    cookieStore.set('otp_challenge', cookieValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 10 * 60, // 10 minutes
      path: '/',
    });

    return NextResponse.json({ success: true, message: 'OTP sent to email.' });
  } catch (error) {
    console.error('Error generating OTP:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
