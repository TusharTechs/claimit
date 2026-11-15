import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, sessions } from '../api';
import { Logo, Spinner } from '../components/ui';

/** Opened from the "use on another device" link: /sell/login#<sellerId>.<key>. The key stays in the URL hash, so it never reaches server logs. */
export default function SellerLogin() {
  const nav = useNavigate();
  const [error, setError] = useState('');

  useEffect(() => {
    const [id, key] = location.hash.slice(1).split('.');
    history.replaceState(null, '', '/sell/login'); // drop the secret from the address bar / history
    if (!id || !key) { setError('This login link is incomplete.'); return; }
    api.sellerLogin(id, key)
      .then((s) => { sessions.setSeller({ id, key, name: s.name, shop: s.shop, upi: s.upi }); nav('/sell', { replace: true }); })
      .catch((e) => setError(e instanceof Error ? e.message : 'That login link is not valid.'));
  }, [nav]);

  return (
    <div className="grid min-h-full place-items-center p-6 text-center">
      <div className="max-w-sm">
        <Logo className="text-xl" />
        {error ? (
          <>
            <p className="mt-6 text-lg font-semibold">{error}</p>
            <p className="mt-1 text-ink-2">Open “Use on another device” in your seller console and scan the code again.</p>
            <Link to="/sell" className="btn mt-5 bg-ink px-5 py-2.5 text-white">Go to seller page</Link>
          </>
        ) : (
          <div className="mt-6 flex items-center justify-center gap-2 text-ink-2"><Spinner className="size-5 text-hot" /> Signing you in…</div>
        )}
      </div>
    </div>
  );
}
