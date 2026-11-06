import { useState } from 'react';

type User = { id: string; email: string; accountId?: string } | null;

export function AuthPanel({ user, onChange }: { user: User; onChange: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erreur');
      setEmail('');
      setPassword('');
      onChange();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
    onChange();
  }

  if (user) {
    return (
      <div className="auth-panel">
        <span className="user-chip">{user.email}</span>
        <button className="btn small" onClick={logout}>Déconnexion</button>
      </div>
    );
  }

  return (
    <form className="auth-panel" onSubmit={submit}>
      <select value={mode} onChange={(e) => setMode(e.target.value as any)} aria-label="Mode">
        <option value="login">Connexion</option>
        <option value="register">Inscription</option>
      </select>
      <input
        type="email"
        placeholder="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <input
        type="password"
        placeholder="mot de passe"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
        minLength={6}
      />
      <button className="btn small" type="submit" disabled={loading}>
        {loading ? '...' : mode === 'login' ? 'Se connecter' : 'Créer'}
      </button>
      {error && <span className="error small">{error}</span>}
    </form>
  );
}
