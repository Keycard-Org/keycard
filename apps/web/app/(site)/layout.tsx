import './site.css'
import { SmoothScroll } from '@/components/site/SmoothScroll'
import { Stage } from '@/components/site/Stage'

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <SmoothScroll>
      {/* before first paint: lets reveal-able text start hidden (a CSS timeout always un-hides it) */}
      <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('kc-js')" }} />
      <div className="kc-site">
        <div className="kc-bg" aria-hidden />
        <Stage />
        <div className="kc-grain" aria-hidden />
        {children}
      </div>
    </SmoothScroll>
  )
}
