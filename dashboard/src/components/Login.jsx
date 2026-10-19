import { useState } from 'react';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  function submit(event) {
    event.preventDefault();
    if (username.trim() === 'admin' && password === 'engine123') {
      onLogin();
    } else {
      setError('Invalid username or password.');
    }
  }

  return (
    <main className="login-page">
      <form className="login-panel" onSubmit={submit}>
        <h1>Welcome back</h1>
        <p className="login-copy">Sign in to view live fleet health and maintenance alerts.</p>
        <label>Username<input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" autoFocus /></label>
        <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /></label>
        {error && <p className="login-error">{error}</p>}
        <button className="login-submit" type="submit">Sign in</button>
        <small className="login-demo">Demo access: admin / engine123</small>
      </form>
    </main>
  );
}
