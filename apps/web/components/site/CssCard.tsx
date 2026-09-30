/**
 * The KEYKARD drawn in HTML/CSS. Used when 3D is off (no WebGL, reduced motion), in small UI spots, and later
 * as the card on the app's home screen. Same design language as the 3D faces in cardFace.ts.
 */
export type CardSkin = 'active' | 'overdue' | 'frozen' | 'defaulted' | 'settled'

export function CssCard({ amount = '$20', skin = 'active', label = 'Available to spend', className = '' }: { amount?: string; skin?: CardSkin; label?: string; className?: string }) {
  return (
    <div className={`kc-css-card kc-css-card--${skin} ${className}`} role="img" aria-label={`KEYKARD, ${skin}, ${amount} ${label.toLowerCase()}`}>
      <div className="kc-css-card__top">
        <span className="kc-css-card__mark">KEYKARD</span>
        <span className="kc-css-card__nfc" aria-hidden>)))</span>
      </div>
      <span className="kc-css-card__chip" aria-hidden />
      <div className="kc-css-card__bottom">
        <div>
          <small>{label}</small>
          <strong>{amount}</strong>
        </div>
        <div className="kc-css-card__meta">
          <span>•••• 5392</span>
          <em>CREDIT · TEMPO</em>
        </div>
      </div>
    </div>
  )
}
