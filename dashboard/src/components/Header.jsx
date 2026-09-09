// src/components/Header.jsx
export default function Header({ connected, activeAlerts, view, setView, goFleet }) {
  const navBtn = (label, key, badge) => (
    <button
      key={key}
      onClick={() => key === 'fleet' ? goFleet() : setView(key)}
      className={`nav-btn ${view === key ? 'nav-btn--active' : ''}`}
    >
      {label}
      {badge > 0 && <span className="badge">{badge}</span>}
    </button>
  );

  return (
    <header className="header">
      <div className="header__left">
        <div className="header__logo">
          <span className="header__logo-icon">⚙</span>
          <div>
            <div className="header__title">Engine Monitor</div>
            <div className="header__sub">Real-Time Engine Monitoring System</div>
          </div>
        </div>
      </div>

      <nav className="header__nav">
        {navBtn('Fleet Overview', 'fleet')}
        {navBtn('Alerts', 'alerts', activeAlerts)}
        {navBtn('Model Info', 'model')}
      </nav>

      <div className="header__right">
        <span className={`conn-badge ${connected ? 'conn-badge--on' : 'conn-badge--off'}`}>
          <span className="conn-dot" />
          {connected ? 'Live' : 'Offline'}
        </span>
    
      </div>
    </header>
  );
}
