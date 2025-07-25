import { useState } from 'react';
import { useRouter } from 'next/router';
import { SiteConfig } from '@/types/siteConfig';
import { getSiteName, getTagline } from '@/utils/client/siteConfig';
import Image from 'next/image';
import { fetchWithAuth } from '@/utils/client/tokenManager';

interface LoginProps {
  siteConfig: SiteConfig | null;
}

export default function Login({ siteConfig }: LoginProps) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  const { redirect } = router.query;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!password.trim()) {
      setError('Password cannot be empty');
      return;
    }

    try {
      const res = await fetchWithAuth('/api/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password, redirect }),
      });

      if (res.ok) {
        const data = await res.json();
        router.push(data.redirect || '/');
      } else if (res.status === 429) {
        setError('Too many login attempts. Please try again later.');
      } else {
        const errorData = await res.json();
        setError(errorData.message || 'Incorrect password');
      }
    } catch (error) {
      console.error('Login error:', error);
      setError('An error occurred. Please try again.');
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100">
      {siteConfig?.loginImage && (
        <div className="flex flex-col items-center mb-6 w-full max-w-md">
          <Image
            src={`/${siteConfig.loginImage}`}
            alt="Login Image"
            width={250}
            height={250}
            className="w-full h-auto object-contain"
          />
        </div>
      )}
      <form
        onSubmit={handleSubmit}
        className="p-6 bg-white rounded shadow-md max-w-md w-full"
      >
        <h1 className="mb-4 text-2xl">Welcome to {getSiteName(siteConfig)}!</h1>
        <p className="mb-4">{getTagline(siteConfig)}</p>
        <div className="relative mb-4">
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="p-2 border border-gray-300 rounded w-full"
            placeholder="Enter Password"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute inset-y-0 right-0 p-2 text-gray-600"
          >
            {showPassword ? '🙈' : '👁️'}
          </button>
        </div>
        {error && <p className="text-red-500 mb-4">{error}</p>}
        <button type="submit" className="p-2 bg-blue-500 text-white rounded">
          Log In
        </button>
      </form>
      {siteConfig?.siteId === 'ananda' && (
        <p className="mt-4 text-center">
          Those with Ananda Library access can get the password from&nbsp;
          <a
            href="https://www.anandalibrary.org/content/ai-chatbot-intro/"
            className="text-blue-500 underline"
          >
            this page in the Ananda Library
          </a>
        </p>
      )}
      {siteConfig?.siteId === 'jairam' && (
        <p className="mt-4 text-center">
          For access, please contact the Free Joe Hunt team.
        </p>
      )}
      <p className="mt-4">
        <a
          href="https://github.com/anandaworldwide/ananda-library-chatbot"
          className="text-blue-400 hover:underline mx-2"
        >
          Open Source Project
        </a>
      </p>
    </div>
  );
}
