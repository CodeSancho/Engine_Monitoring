
// src/components/Header.jsx

function Header({
  connected,
  activeAlerts,
  view,
  setView,
  goFleet,
}) {
  const navBtn = (label, key, badge) => {
    return (
      <button
        key={key}
        onClick={() => {
          if (key === 'fleet') {
            goFleet();
          } else {
            setView(key);
          }
        }}
        className={
          view === key
            ? 'nav-btn nav-btn--active'
            : 'nav-btn'
        }
      >
        {label}

        {badge > 0 && (
          <span className="badge">
            {badge}
          </span>
        )}
      </button>
    );
  };

  return (
    <header className="header">

      <div className="header__left">
        <div className="header__logo">

          <span className="header__logo-icon">
            ⚙
          </span>

          <div>
            <div className="header__title">
              Engine Monitor
            </div>

            <div className="header__sub">
              Real-Time Engine Monitoring System
            </div>
          </div>

        </div>
      </div>

      <nav className="header__nav">

        {navBtn(
          'Fleet Overview',
          'fleet'
        )}

        {navBtn(
          'Alerts',
          'alerts',
          activeAlerts
        )}

        {navBtn(
          'Model Info',
          'model'
        )}

        {navBtn(
          'Anomaly Injector',
          'inject'
        )}

      </nav>

      <div className="header__right">

        <span
          className={
            connected
              ? 'conn-badge conn-badge--on'
              : 'conn-badge conn-badge--off'
          }
        >
          <span className="conn-dot" />

          {connected ? 'Live' : 'Offline'}
        </span>

      </div>

    </header>
  );
}

export default Header;

