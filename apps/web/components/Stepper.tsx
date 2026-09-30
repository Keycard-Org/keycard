/** Labelled progress: done steps dim, the current one lit. */
export function Stepper({ steps, at }: { steps: string[]; at: number }) {
  return (
    <div className="stepper" role="list" aria-label={`Step ${at + 1} of ${steps.length}: ${steps[at]}`}>
      {steps.map((s, i) => (
        <div key={s} role="listitem" className={i < at ? 'done' : i === at ? 'on' : ''} aria-current={i === at ? 'step' : undefined}>
          {s}
        </div>
      ))}
    </div>
  )
}
