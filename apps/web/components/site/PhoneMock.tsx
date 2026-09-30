import { CssCard } from './CssCard'

/** The app's home screen, in a phone frame. Built in HTML (no screenshots), matching the app's layout. */
export function PhoneMock() {
  return (
    <div className="kc-phone" aria-label="The KEYCARD app home screen">
      <div className="kc-phone__screen">
        <div className="kc-phone__status"><span>9:41</span><span className="kc-phone__island" /><span>5G</span></div>
        <div className="kc-phone__hello">
          <span>Hi, maya</span>
          <span className="kc-dot kc-dot--ok">Auto-pay on</span>
        </div>
        <CssCard amount="$42.00" className="kc-phone__card" />
        <div className="kc-phone__chips">
          <span>Owed <b>$8.00</b></span>
          <span>Bill in <b>6 days</b></span>
        </div>
        <div className="kc-phone__actions">
          {['Pay', 'Repay', 'Add', 'Card'].map((a) => (
            <span key={a}><i />{a}</span>
          ))}
        </div>
        <div className="kc-phone__list">
          <p>Today</p>
          {[
            ['Coffee', '−$4.20', 'Paid to merchant'],
            ['Groceries', '−$3.80', 'Paid to merchant'],
            ['Auto-pay', '+$8.00', 'Bill paid on time'],
          ].map(([n, a, s]) => (
            <div key={n}>
              <span><b>{n}</b><small>{s}</small></span>
              <em>{a}</em>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
