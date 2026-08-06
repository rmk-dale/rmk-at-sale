import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyHash, generateHash } from '@/lib/crypto';

export async function POST(req: NextRequest) {
  try {
    const { otp } = await req.json();

    if (!otp || typeof otp !== 'string') {
      return NextResponse.json({ error: 'OTP is required' }, { status: 400 });
    }

    const cookieStore = await cookies();
    const challengeCookie = cookieStore.get('otp_challenge');

    if (!challengeCookie) {
      return NextResponse.json({ error: 'No OTP challenge found. Please request a new code.' }, { status: 400 });
    }

    const { email, expires, hash } = JSON.parse(challengeCookie.value);

    // 1. Check if the OTP has expired
    if (Date.now() > expires) {
      return NextResponse.json({ error: 'OTP has expired. Please request a new code.' }, { status: 400 });
    }

    // 2. Verify the hash using the submitted OTP
    const payloadToVerify = `${email}|${expires}|${otp}`;
    const isValid = verifyHash(payloadToVerify, hash);

    if (!isValid) {
      return NextResponse.json({ error: 'Invalid OTP' }, { status: 401 });
    }

    // 3. Clear the challenge cookie
    cookieStore.delete('otp_challenge');

    // 4. Set the authenticated session cookie
    // We sign the email so it cannot be tampered with by the client.
    const sessionExpires = Date.now() + 24 * 60 * 60 * 1000; // 1 day
    const sessionHash = generateHash(`${email}|${sessionExpires}`);
    const sessionValue = JSON.stringify({ email, expires: sessionExpires, hash: sessionHash });

    cookieStore.set('session', sessionValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60, // 1 day
      path: '/',
    });

    return NextResponse.json({ success: true, email });
  } catch (error) {
    console.error('Error verifying OTP:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  // Utility endpoint to check if the user is currently logged in.
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('session');

  if (!sessionCookie) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  try {
    const { email, expires, hash } = JSON.parse(sessionCookie.value);
    
    if (Date.now() > expires) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    const isValid = verifyHash(`${email}|${expires}`, hash);

    if (isValid) {
      return NextResponse.json({ authenticated: true, email });
    } else {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }
  } catch (e) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
}

export async function DELETE(req: NextRequest) {
  // Utility endpoint to logout
  const cookieStore = await cookies();
  cookieStore.delete('session');
  return NextResponse.json({ success: true });
}
