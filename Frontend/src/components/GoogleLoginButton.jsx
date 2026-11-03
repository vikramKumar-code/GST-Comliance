import { useState } from 'react';
import { googleAuth } from '../api/auth.api';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Loader2, AlertCircle, ExternalLink } from 'lucide-react';

export default function GoogleLoginButton({ onSuccess, onError }) {
  const [loading, setLoading] = useState(false);
  const [showConfigNotice, setShowConfigNotice] = useState(false);
  const { loginSuccess } = useAuth();
  const navigate = useNavigate();

  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  const loadGoogleScript = () => {
    return new Promise((resolve) => {
      if (window.google?.accounts?.id) {
        resolve(true);
        return;
      }
      const existingScript = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
      if (existingScript) {
        existingScript.onload = () => resolve(true);
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  };

  const handleCredentialResponse = async (response) => {
    if (!response?.credential) return;
    setLoading(true);
    try {
      const res = await googleAuth(response.credential);
      if (res && res.success) {
        loginSuccess(res);
        if (onSuccess) onSuccess(res);
        navigate('/dashboard');
      }
    } catch (err) {
      if (onError) onError(err);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleClick = async () => {
    if (!googleClientId || googleClientId.includes('your_google_client_id') || googleClientId.trim() === '') {
      setShowConfigNotice(true);
      return;
    }

    setLoading(true);
    try {
      const loaded = await loadGoogleScript();
      if (!loaded || !window.google?.accounts?.id) {
        throw new Error('Google Sign-In SDK could not be loaded. Please check your internet connection.');
      }

      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: handleCredentialResponse
      });

      // Prompt official Google Sign-In popup
      window.google.accounts.id.prompt((notification) => {
        if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
          setLoading(false);
        }
      });
    } catch (err) {
      if (onError) onError(err);
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleGoogleClick}
        disabled={loading}
        className="w-full py-2.5 px-4 flex items-center justify-center gap-2.5 rounded-xl border border-surface-border bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-xs transition-all hover:border-slate-300 disabled:opacity-60 cursor-pointer"
      >
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin text-slate-500" />
            <span>Connecting to Google...</span>
          </>
        ) : (
          <>
            <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
              <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.616z" fill="#4285F4"/>
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
              <path d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05"/>
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 7.293C4.672 5.166 6.656 3.58 9 3.58z" fill="#EA4335"/>
            </svg>
            <span>Continue with Google</span>
          </>
        )}
      </button>

      {/* Google Cloud Console Setup Guidance Modal */}
      {showConfigNotice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0 mt-0.5">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-slate-900">
                  Google OAuth 2.0 Credentials Pending
                </h3>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  The Google OAuth codebase is fully integrated. To enable live sign-in with your Google account, configure your Client ID:
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-xs mb-4">
              <div className="flex items-start gap-2">
                <span className="font-bold text-indigo-600">1.</span>
                <span className="text-slate-700">Open <b>Google Cloud Console</b> &gt; APIs &amp; Services &gt; Credentials.</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="font-bold text-indigo-600">2.</span>
                <span className="text-slate-700">Create <b>OAuth Client ID (Web Application)</b> with origin <code>http://localhost:5173</code>.</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="font-bold text-indigo-600">3.</span>
                <span className="text-slate-700">Add to <code>Frontend/.env</code>: <br/><code className="text-[10px] bg-slate-200 px-1 py-0.5 rounded">VITE_GOOGLE_CLIENT_ID=your_id.apps.googleusercontent.com</code></span>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
              <a
                href="https://console.cloud.google.com/apis/credentials"
                target="_blank"
                rel="noreferrer"
                className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
              >
                <span>Google Cloud Console</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <button
                type="button"
                onClick={() => setShowConfigNotice(false)}
                className="px-4 py-2 text-xs font-bold rounded-xl bg-slate-900 text-white hover:bg-slate-800 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
