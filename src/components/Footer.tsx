export default function Footer() {
  return (
    <footer className="mt-auto border-t border-line/70 py-5 text-center text-xs text-ink2/70">
      <span className="font-semibold text-ink2">onebeep</span> · contactless
      vitals in your browser · not a medical device · based on{' '}
      <a
        href="https://doi.org/10.1364/OE.18.010762"
        target="_blank"
        rel="noopener noreferrer"
        className="underline hover:text-ink"
        title="Poh, McDuff, Picard — Non-contact automated cardiac pulse measurements, Optics Express 2010"
      >
        Poh et al. (2010)
      </a>
    </footer>
  )
}
