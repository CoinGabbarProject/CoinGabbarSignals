# Navigation click fix

The trader navigation is implemented as real button controls with client-side `history.pushState` navigation.

Top items:
- Active Signals -> /signals
- Signal History -> /history
- Performance -> /performance
- Watchlist -> /watchlist
- Market Analysis -> /market
- Tools -> /tools
- Alerts -> /alerts
- Settings -> /settings

The navigation dispatches the `cgs:navigate` event after every click so the main React shell immediately renders the corresponding dedicated page. `pointer-events`, z-index, focus, and keyboard handling are explicitly enabled for the navigation controls.
